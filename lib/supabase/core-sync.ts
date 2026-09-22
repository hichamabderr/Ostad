import type { SupabaseClient } from '@supabase/supabase-js';
import { getEmptyState, isDemoState, type AppState } from '@/lib/storage';
import type { ClassRoom, SessionRecord, Student, StudentGrade, TimetableSlot } from '@/lib/types';
import type { Database } from './database.types';
import { getWeeklyHours } from '@/lib/curriculum-data';
import { enqueueSyncState, type SyncEntity, type SyncOperation, type SyncOutboxEntry } from '@/lib/sync-outbox';
import { stableUuid } from './migrate-local-state';
import { normalizeDateToIso } from '@/lib/date-utils';

type Client = SupabaseClient<Database>;
type AnyClient = { from(table: string): any; auth: any; rpc: any; storage: any };
export interface SyncMetadata { revision: number; updatedAt: string; deviceId: string; }
export class SyncConflictError extends Error {
  code = 'SYNC_CONFLICT';
  constructor(public entity: SyncEntity, public recordId: string, public remoteRevision: number, public localRevision: number) {
    super(`Sync conflict for ${entity}/${recordId}: remote revision ${remoteRevision} is newer`);
    this.name = 'SyncConflictError';
  }
}

function schemaError(error: unknown): boolean {
  const e = error as { code?: string; message?: string; details?: string; hint?: string } | null;
  const text = [e?.message, e?.details, e?.hint].filter(Boolean).join(' ');
  return e?.code === 'PGRST205' || /schema cache|could not find the table|relation .* does not exist/i.test(text);
}
function localOnly(): Error { return Object.assign(new Error('Supabase schema is unavailable. Remaining in local-only mode.'), { code: 'LOCAL_ONLY_CLOUD' }); }
const tables: Record<SyncEntity, string> = {
  class: 'classes', student: 'students', grade: 'grades', session: 'sessions',
  timetable: 'timetable_slots', lessonProgress: 'lesson_progress', customUnit: 'custom_units',
  lessonPlan: 'lesson_plans', attendance: 'attendance', behavior: 'session_behaviors',
  dashboardTask: 'dashboard_tasks',
  profile: 'profiles', settings: 'app_settings',
};
const isObject = (v: unknown): v is Record<string, any> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function getCloudRecordId(ownerId: string, entity: SyncEntity, localId: string): string {
  return isUuid(localId) ? localId : stableUuid(`${entity}:${ownerId}:${localId}`);
}
async function workspaceId(client: AnyClient, ownerId: string): Promise<string> {
  const result = await client.rpc('default_workspace_id');
  if (result.error) throw result.error;
  if (typeof result.data !== 'string' || !isUuid(result.data)) {
    throw new Error('Supabase workspace is unavailable for this user');
  }
  return result.data;
}

function toRow(entity: SyncEntity, payload: any, ownerId: string, workspace: string, metadata: SyncMetadata): Record<string, any> {
  const id = getCloudRecordId(ownerId, entity, payload.id);
  const classId = (value: string | undefined) => value ? getCloudRecordId(ownerId, 'class', value) : null;
  const studentId = (value: string | undefined) => value ? getCloudRecordId(ownerId, 'student', value) : null;
  const sessionId = (value: string | undefined) => value ? getCloudRecordId(ownerId, 'session', value) : null;
  const unitId = (value: string | undefined) => value ? getCloudRecordId(ownerId, 'customUnit', value) : null;
  const base = { id, owner_id: ownerId, workspace_id: workspace, revision: metadata.revision, sync_revision: metadata.revision, updated_by: ownerId, sync_device_id: metadata.deviceId, sync_updated_at: metadata.updatedAt };
  switch (entity) {
    case 'class': return { ...base, name: payload.name.trim(), level: payload.level, section: payload.stream || null, weekly_hours: getWeeklyHours(payload.level), academic_year: null, notes: null };
    case 'student': return { ...base, class_id: classId(payload.classId), full_name: payload.fullName.trim(), number_in_list: payload.numberInList, reg_number: payload.regNumber || null, registration_number: payload.registrationNumber || null, is_repeater: payload.isRepeater ?? false, guardian_phone: payload.guardianPhone || null, gender: payload.gender === 'M' ? 'male' : payload.gender === 'F' ? 'female' : null, birth_date: normalizeDateToIso(payload.birthDate) || null, notes: payload.notes || null };
    case 'grade': return { ...base, student_id: studentId(payload.studentId), class_id: classId(payload.classId), trimester: payload.trimester, continuous_eval: payload.continuousEval, behavior_score: payload.behaviorScore ?? null, attendance_score: payload.attendanceScore ?? null, notebook_score: payload.notebookScore ?? null, participation_score: payload.participationScore ?? null, quiz: payload.quiz, exam: payload.exam, calculated_average: payload.calculatedAverage ?? null, estimation: payload.estimation || null, guidance: payload.guidance || null, remarks: payload.remarks || null, follow_up_notes: payload.followUpNotes || null };
    case 'timetable': return { ...base, class_id: classId(payload.classId), weekday: payload.dayOfWeek, start_time: payload.startTime, end_time: payload.endTime, room: payload.room || null, notes: payload.type || null };
    case 'lessonProgress': return { ...base, class_id: classId(payload.classId), unit_id: null, unit_key: payload.unitId || null, status: payload.status, completed_at: payload.completedAt || null, notes: JSON.stringify(payload) };
    case 'session': return { ...base, class_id: classId(payload.classId), session_date: payload.date, start_time: payload.startTime, end_time: payload.endTime, topic: payload.customTopic || null, teacher_notes: JSON.stringify(payload) };
    case 'customUnit': return { ...base, title: payload.title, level: payload.level, position: payload.unitNumber || 0, metadata: payload };
    case 'lessonPlan': return { ...base, class_id: classId(payload.classId), unit_id: null, title: payload.title || '', content: payload };
    case 'attendance': return {
      ...base,
      session_id: sessionId(payload.sessionId),
      student_id: studentId(payload.studentId),
      status: payload.status === 'ABSENT' ? 'absent' : payload.status === 'LATE' ? 'late' : payload.status === 'EXCUSED' ? 'excused' : 'present',
      note: payload.note || null,
    };
    case 'behavior': return {
      ...base,
      session_id: sessionId(payload.sessionId),
      student_id: studentId(payload.studentId),
      behavior: payload.behavior,
      rating: null,
      note: null,
    };
    case 'dashboardTask': return {
      ...base,
      task_id: payload.id,
      text: payload.text,
      done: Boolean(payload.done),
    };
    default: return payload;
  }
}

function fromRow(entity: SyncEntity, row: any): any {
  if (entity === 'class') return { id: row.id, name: row.name, level: row.level || '1AS_SCIENCE', stream: row.section || '' } satisfies ClassRoom;
  if (entity === 'student') return { id: row.id, classId: row.class_id, numberInList: row.number_in_list, fullName: row.full_name, regNumber: row.reg_number || undefined, registrationNumber: row.registration_number || undefined, gender: row.gender === 'male' ? 'M' : row.gender === 'female' ? 'F' : undefined, birthDate: row.birth_date || undefined, notes: row.notes || undefined, isRepeater: row.is_repeater, guardianPhone: row.guardian_phone || undefined } satisfies Student;
  if (entity === 'grade') return { id: row.id, studentId: row.student_id, classId: row.class_id, trimester: row.trimester, continuousEval: row.continuous_eval, behaviorScore: row.behavior_score, attendanceScore: row.attendance_score, notebookScore: row.notebook_score, participationScore: row.participation_score, quiz: row.quiz, exam: row.exam, calculatedAverage: row.calculated_average, estimation: row.estimation || undefined, guidance: row.guidance || undefined, remarks: row.remarks || undefined, followUpNotes: row.follow_up_notes || undefined } satisfies StudentGrade;
  if (entity === 'session' || entity === 'lessonProgress') {
    const encoded = row.teacher_notes || row.notes;
    if (typeof encoded === 'string') {
      try {
        const parsed = JSON.parse(encoded);
        if (isObject(parsed)) {
          if (entity === 'session') {
            return {
              ...parsed,
              id: row.id,
              classId: row.class_id,
              date: row.session_date,
              startTime: row.start_time || parsed.startTime || '',
              endTime: row.end_time || parsed.endTime || '',
            };
          }
          return parsed;
        }
      } catch { /* retain compatibility with rows written by older clients */ }
    }
  }
  if (['customUnit', 'lessonPlan'].includes(entity) && isObject(row.metadata || row.content)) return row.metadata || row.content;
  if (entity === 'timetable') return { id: row.id, classId: row.class_id, dayOfWeek: row.weekday, startTime: row.start_time, endTime: row.end_time, room: row.room || undefined, type: row.notes || undefined } satisfies TimetableSlot;
  return null;
}

export async function loadCoreState(client: Client, localState: AppState): Promise<AppState> {
  try {
    const c = client as AnyClient;
    const userId = (await c.auth.getUser()).data.user?.id;
    if (!userId) return localState;
    const results = await Promise.all(Object.entries(tables).map(async ([entity, table]) => {
      const query = c.from(table).select('*');
      const result = entity === 'profile' ? await query.eq('id', userId) : await query.eq('owner_id', userId);
      return [entity, result] as const;
    }));
    const memorandaResult = await c.from('memoranda_files').select('unit_key,file_name,storage_path,created_at,updated_at,is_bundled,deleted_at').eq('owner_id', userId).eq('is_bundled', false).is('deleted_at', null);
    if (memorandaResult.error) throw memorandaResult.error;
    for (const [, result] of results) if (result.error) throw result.error;
    let maxRevision = 0;
    for (const [, result] of results) {
      for (const row of result.data || []) {
        const rev = Number(row.sync_revision ?? row.revision ?? 0);
        if (rev > maxRevision) maxRevision = rev;
      }
    }
    const by = (entity: SyncEntity) => (results.find(([key]) => key === entity)?.[1].data || []);
    const remoteClasses = by('class').map((r: any) => fromRow('class', r));
    const remoteClassIds = new Set(remoteClasses.map((c: ClassRoom) => c.id));
    const retainedLocalClasses = (localState.classes || []).filter(
      (c) => !remoteClassIds.has(c.id) && !localState.deletedRecordIds?.includes(`class:${c.id}`)
    );
    const classes = remoteClasses.length > 0
      ? (retainedLocalClasses.length > 0 ? [...remoteClasses, ...retainedLocalClasses] : remoteClasses)
      : (isDemoState(localState) ? [] : retainedLocalClasses);

    const remoteStudents = by('student').map((r: any) => fromRow('student', r));
    const remoteStudentIds = new Set(remoteStudents.map((s: Student) => s.id));
    const retainedLocalStudents = (localState.students || []).filter(
      (s) => !remoteStudentIds.has(s.id) && !localState.deletedRecordIds?.includes(`student:${s.id}`)
    );
    const students = remoteStudents.length > 0
      ? (retainedLocalStudents.length > 0 ? [...remoteStudents, ...retainedLocalStudents] : remoteStudents)
      : (isDemoState(localState) ? [] : retainedLocalStudents);

    if (!classes.length && !students.length && !by('grade').length && isDemoState(localState)) return getEmptyState();
    const profile = by('profile')[0];
    let remoteAvatarUrl: string | undefined;
    if (profile?.avatar_storage_key) {
      const signedAvatar = await c.storage.from('avatars').createSignedUrl(profile.avatar_storage_key, 604800);
      if (signedAvatar.error) throw signedAvatar.error;
      remoteAvatarUrl = signedAvatar.data?.signedUrl;
    }
    const settings = by('settings')[0]?.settings;
    const supplementary = isObject(settings) ? settings : {};
    const dashboardTasks = by('dashboardTask').map((row: any) => ({
      id: row.task_id,
      text: row.text,
      done: Boolean(row.done),
    }));
    const remoteUnitPdfFiles = Object.fromEntries(
      (memorandaResult.data || [])
        .filter((row: any) => typeof row.unit_key === 'string' && typeof row.storage_path === 'string')
        .map((row: any) => [row.unit_key, {
          fileName: row.file_name,
          cloudStoragePath: row.storage_path,
          uploadedAt: (row.updated_at || row.created_at || new Date().toISOString()).slice(0, 10),
        }]),
    );
    const sessions: SessionRecord[] = by('session')
      .map((r: any) => fromRow('session', r))
      .filter(Boolean);
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    for (const session of sessions) {
      session.attendance = {};
      session.disruptions = [];
      session.unwrittenLessons = [];
      session.poorParticipation = [];
      session.goodParticipation = [];
    }
    for (const row of by('attendance')) {
      const session = sessionsById.get(row.session_id);
      if (session) {
        session.attendance[row.student_id] = row.status === 'absent'
          ? 'ABSENT'
          : row.status === 'late'
            ? 'LATE'
            : row.status === 'excused'
              ? 'EXCUSED'
              : 'PRESENT';
      }
    }
    const behaviorTargets: Record<string, 'disruptions' | 'unwrittenLessons' | 'poorParticipation' | 'goodParticipation'> = {
      disruptions: 'disruptions',
      unwrittenLessons: 'unwrittenLessons',
      poorParticipation: 'poorParticipation',
      goodParticipation: 'goodParticipation',
    };
    for (const row of by('behavior')) {
      const session = sessionsById.get(row.session_id);
      const target = behaviorTargets[row.behavior];
      if (session && target) {
        (session[target] ??= []).push(row.student_id);
      }
    }
    return { ...localState, ...supplementary, profile: profile ? {
        ...localState.profile,
        name: profile.full_name || localState.profile.name,
        title: profile.title || localState.profile.title,
        schoolName: profile.school_name || localState.profile.schoolName,
        stateName: profile.state_name || localState.profile.stateName,
        academicYear: profile.academic_year || localState.profile.academicYear,
        hijriYear: profile.hijri_year || localState.profile.hijriYear,
        firstNameAr: profile.first_name_ar || undefined,
        lastNameAr: profile.last_name_ar || undefined,
        firstNameEn: profile.first_name_en || undefined,
        lastNameEn: profile.last_name_en || undefined,
        email: profile.email || undefined,
        phoneNumber: profile.phone || undefined,
        avatarUrl: remoteAvatarUrl || profile.avatar_url || undefined,
        avatarStorageKey: profile.avatar_storage_key || undefined,
        firstAppointmentDate: profile.first_appointment_date || undefined,
        experienceYears: profile.experience_years ?? undefined,
        birthDate: profile.birth_date || undefined,
        birthPlace: profile.birth_place || undefined,
        familyStatus: profile.family_status || undefined,
        gender: profile.gender === 'M' || profile.gender === 'F' ? profile.gender : undefined,
      } : localState.profile,
      classes, students, grades: by('grade').map((r: any) => fromRow('grade', r)),
      sessions, timetable: by('timetable').map((r: any) => fromRow('timetable', r)).filter(Boolean),
      lessonProgress: by('lessonProgress').map((r: any) => fromRow('lessonProgress', r)).filter(Boolean), customUnits: by('customUnit').map((r: any) => fromRow('customUnit', r)).filter(Boolean), lessonPlans: by('lessonPlan').map((r: any) => fromRow('lessonPlan', r)).filter(Boolean), dashboardTasks,
      unitPdfFiles: {
        ...(localState.unitPdfFiles || {}),
        ...remoteUnitPdfFiles,
      },
      activeClassId: classes.some((item: ClassRoom) => item.id === localState.activeClassId) ? localState.activeClassId : classes[0]?.id || null,
      cloudRevision: maxRevision };
  } catch (error) { if (schemaError(error)) throw localOnly(); throw error; }
}

async function applyOperationOnce(client: AnyClient, ownerId: string, workspace: string, operation: SyncOperation, metadata: SyncMetadata): Promise<void> {
  const table = tables[operation.entity];
  const recordId = getCloudRecordId(ownerId, operation.entity, operation.recordId);
  const conflictIfStale = async (existing: any): Promise<void> => {
    const remoteRevision = Number(existing?.sync_revision ?? existing?.revision ?? 0);
    const remoteDevice = existing?.sync_device_id || existing?.updated_by || null;
    if (!existing || remoteRevision <= metadata.revision || remoteDevice === metadata.deviceId) return;
    const conflict = await client.from('sync_conflicts').insert({
      workspace_id: workspace,
      owner_id: ownerId,
      entity_type: operation.entity,
      entity_id: recordId,
      local_revision: metadata.revision,
      remote_revision: remoteRevision,
      local_device_id: metadata.deviceId,
      remote_device_id: remoteDevice,
      resolution: 'pending',
    });
    if (conflict.error) throw conflict.error;
    throw new SyncConflictError(operation.entity, operation.recordId, remoteRevision, metadata.revision);
  };
  if (operation.entity === 'profile') {
    const p = operation.payload as any;
    const existing = await client.from(table).select('sync_revision,sync_device_id').eq('id', ownerId).maybeSingle();
    if (existing.error) throw existing.error;
    await conflictIfStale(existing.data);
    const result = await client.from(table).upsert({
      id: ownerId,
      sync_revision: metadata.revision,
      sync_updated_at: metadata.updatedAt,
      sync_device_id: metadata.deviceId,
      full_name: p.name || null,
      title: p.title || null,
      school_name: p.schoolName || null,
      state_name: p.stateName || null,
      academic_year: p.academicYear || null,
      hijri_year: p.hijriYear || null,
      first_name_ar: p.firstNameAr || null,
      last_name_ar: p.lastNameAr || null,
      first_name_en: p.firstNameEn || null,
      last_name_en: p.lastNameEn || null,
      email: p.email || null,
      phone: p.phoneNumber || null,
      avatar_url: typeof p.avatarUrl === 'string' && !p.avatarUrl.startsWith('data:') ? p.avatarUrl : null,
      avatar_storage_key: p.avatarStorageKey || null,
      first_appointment_date: normalizeDateToIso(p.firstAppointmentDate) || null,
      experience_years: p.experienceYears ?? null,
      birth_date: normalizeDateToIso(p.birthDate) || null,
      birth_place: p.birthPlace || null,
      family_status: p.familyStatus || null,
      gender: p.gender || null,
    }, { onConflict: 'id' });
    if (result.error) throw result.error; return;
  }

  if (operation.entity === 'settings') {
    const existing = await client.from(table).select('sync_revision,sync_device_id').eq('owner_id', ownerId).eq('workspace_id', workspace).maybeSingle();
    if (existing.error) throw existing.error;
    await conflictIfStale(existing.data);
    const result = await client.from(table).upsert({
      owner_id: ownerId,
      workspace_id: workspace,
      settings: operation.payload,
      revision: metadata.revision,
      sync_revision: metadata.revision,
      sync_updated_at: metadata.updatedAt,
      sync_device_id: metadata.deviceId,
      updated_by: ownerId,
    }, { onConflict: 'workspace_id' });
    if (result.error) throw result.error; return;
  }
  const existing = await client.from(table).select('revision,sync_revision,updated_by,sync_device_id').eq('id', recordId).eq('owner_id', ownerId).eq('workspace_id', workspace).maybeSingle();
  if (existing.error) throw existing.error;
  await conflictIfStale(existing.data);
  if (operation.action === 'upsert') {
    const tombstone = await client.from('sync_tombstones')
      .select('revision,device_id')
      .eq('workspace_id', workspace)
      .eq('owner_id', ownerId)
      .eq('entity_type', operation.entity)
      .eq('entity_id', recordId)
      .maybeSingle();
    if (tombstone.error) throw tombstone.error;
    if (tombstone.data && Number(tombstone.data.revision) >= metadata.revision && tombstone.data.device_id !== metadata.deviceId) {
      throw new SyncConflictError(operation.entity, operation.recordId, Number(tombstone.data.revision), metadata.revision);
    }
    const result = await client.from(table).upsert(toRow(operation.entity, operation.payload, ownerId, workspace, metadata), { onConflict: 'id' });
    if (result.error) throw result.error;
    if (tombstone.data) {
      const cleared = await client.from('sync_tombstones').delete()
        .eq('workspace_id', workspace)
        .eq('owner_id', ownerId)
        .eq('entity_type', operation.entity)
        .eq('entity_id', recordId);
      if (cleared.error) throw cleared.error;
    }
    return;
  }
  const tombstone = await client.from('sync_tombstones').upsert({
    workspace_id: workspace,
    owner_id: ownerId,
    entity_type: operation.entity,
    entity_id: recordId,
    revision: metadata.revision,
    device_id: metadata.deviceId,
  }, { onConflict: 'workspace_id,entity_type,entity_id' });
  if (tombstone.error) throw tombstone.error;
  const result = await client.from(table).delete().eq('id', recordId).eq('owner_id', ownerId).eq('workspace_id', workspace);
  if (result.error) throw result.error;
}

async function applyOperation(client: AnyClient, ownerId: string, workspace: string, operation: SyncOperation, metadata: SyncMetadata): Promise<void> {
  const operationId = `${metadata.revision}:${metadata.updatedAt}:${operation.id}`;
  const existing = await client.from('sync_operations')
    .select('operation_id')
    .eq('workspace_id', workspace)
    .eq('operation_id', operationId)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;
  await applyOperationOnce(client, ownerId, workspace, operation, metadata);
  const claim = await client.rpc('claim_sync_operation', {
    p_workspace_id: workspace,
    p_owner_id: ownerId,
    p_operation_id: operationId,
  });
  if (claim.error) throw claim.error;
}

export async function saveCoreState(client: Client, ownerId: string, state: AppState, metadata: SyncMetadata = { revision: 0, updatedAt: new Date().toISOString(), deviceId: 'server' }): Promise<void> {
  try {
    const id = await enqueueSyncState(ownerId, state, metadata.revision, metadata.updatedAt);
    const entry = (await import('@/lib/sync-outbox')).listSyncOutbox;
    const pending = await entry(ownerId);
    const current = pending.find(item => item.id === id);
    if (!current) throw new Error('Unable to create sync operations');
    const workspace = await workspaceId(client as AnyClient, ownerId);
    for (const operation of current.operations) await applyOperation(client as AnyClient, ownerId, workspace, operation, metadata);
    await (await import('@/lib/sync-outbox')).removeSyncOutboxEntry(id);
  } catch (error) { if (schemaError(error)) throw localOnly(); throw error; }
}

export async function applySyncOutboxEntry(client: Client, ownerId: string, entry: SyncOutboxEntry, deviceId: string): Promise<void> {
  try {
    const workspace = await workspaceId(client as AnyClient, ownerId);
    for (const operation of entry.operations) {
      await applyOperation(client as AnyClient, ownerId, workspace, operation, {
        revision: entry.revision,
        updatedAt: entry.updatedAt,
        deviceId,
      });
    }
  } catch (error) {
    if (schemaError(error)) throw localOnly();
    throw error;
  }
}

export async function resetCloudWorkspace(client: Client, ownerId: string): Promise<void> {
  const result = await client.rpc('reset_workspace');
  if (result.error) throw result.error;
}
