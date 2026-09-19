import type { SupabaseClient } from '@supabase/supabase-js';
import { getEmptyState, isDemoState } from '@/lib/storage';
import type { AppState } from '@/lib/storage';
import type { ClassRoom, Student, StudentGrade } from '@/lib/types';
import type { Database } from './database.types';
import { stableUuid } from './migrate-local-state';

type Client = SupabaseClient<Database>;

export async function resetCloudWorkspace(client: Client, ownerId: string): Promise<void> {
  const files = await client
    .from('memoranda_files')
    .select('storage_path')
    .eq('owner_id', ownerId);
  if (files.error) throw files.error;

  const removed = await client.rpc('reset_workspace');
  if (removed.error) throw removed.error;

  const paths = files.data.map((file) => file.storage_path);
  if (paths.length > 0) {
    const storageResult = await client.storage.from('memoranda').remove(paths);
    if (storageResult.error) throw storageResult.error;
  }
}

export interface SyncMetadata {
  revision: number;
  updatedAt: string;
  deviceId: string;
}

function isSchemaUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = [candidate.message, candidate.details, candidate.hint]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toLowerCase();

  return candidate.code === 'PGRST205' || /schema cache|could not find the table|relation .* does not exist/i.test(text);
}

function createLocalOnlyCloudError(): Error {
  const error = new Error('Supabase schema is unavailable. Remaining in local-only mode.');
  return Object.assign(error, { code: 'LOCAL_ONLY_CLOUD' });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cloudId(ownerId: string, kind: string, localId: string): string {
  return isUuid(localId) ? localId : stableUuid(`${kind}:${ownerId}:${localId}`);
}

function toClass(row: Database['public']['Tables']['classes']['Row']): ClassRoom {
  return {
    id: row.id,
    name: row.name,
    level: (row.level as ClassRoom['level']) || '1AS_SCIENCE',
    stream: row.section || '',
  };
}

function toStudent(row: Database['public']['Tables']['students']['Row']): Student {
  return {
    id: row.id,
    classId: row.class_id,
    numberInList: row.number_in_list,
    fullName: row.full_name,
    regNumber: row.reg_number || undefined,
    registrationNumber: row.registration_number || undefined,
    gender: row.gender === 'male' ? 'M' : row.gender === 'female' ? 'F' : undefined,
    birthDate: row.birth_date || undefined,
    notes: row.notes || undefined,
    isRepeater: row.is_repeater,
    guardianPhone: row.guardian_phone || undefined,
  };
}

function toGrade(row: Database['public']['Tables']['grades']['Row']): StudentGrade {
  return {
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    trimester: row.trimester,
    continuousEval: row.continuous_eval,
    behaviorScore: row.behavior_score,
    attendanceScore: row.attendance_score,
    notebookScore: row.notebook_score,
    participationScore: row.participation_score,
    quiz: row.quiz,
    exam: row.exam,
    calculatedAverage: row.calculated_average,
    estimation: row.estimation || undefined,
    guidance: row.guidance || undefined,
    remarks: row.remarks || undefined,
    followUpNotes: row.follow_up_notes || undefined,
  };
}

export async function loadCoreState(client: Client, localState: AppState): Promise<AppState> {
  try {
    const [classesResult, studentsResult, gradesResult, settingsResult] = await Promise.all([
      client.from('classes').select('*').order('name'),
      client.from('students').select('*').order('class_id').order('number_in_list'),
      client.from('grades').select('*'),
      client.from('app_settings').select('settings').maybeSingle(),
    ]);
    if (classesResult.error) throw classesResult.error;
    if (studentsResult.error) throw studentsResult.error;
    if (gradesResult.error) throw gradesResult.error;
    if (settingsResult.error) throw settingsResult.error;

    if (classesResult.data.length === 0 && studentsResult.data.length === 0 && gradesResult.data.length === 0) {
      // Demo data is a presentation seed, never a user's workspace.
      return isDemoState(localState) ? getEmptyState() : localState;
    }

    const classes = classesResult.data.map(toClass);
    const classIds = new Set(classes.map((item) => item.id));
    const students = studentsResult.data.filter((item) => classIds.has(item.class_id)).map(toStudent);
    const studentIds = new Set(students.map((item) => item.id));
    const grades = gradesResult.data
      .filter((item) => classIds.has(item.class_id) && studentIds.has(item.student_id))
      .map(toGrade);

    const settings = settingsResult.data?.settings;
    const supplementary = settings && typeof settings === 'object' && !Array.isArray(settings)
      ? settings as Partial<AppState>
      : {};

    return {
      ...localState,
      ...supplementary,
      classes,
      students,
      grades,
      activeClassId: classes.some((item) => item.id === localState.activeClassId)
        ? localState.activeClassId
        : classes[0]?.id || null,
    };
  } catch (error) {
    if (isSchemaUnavailableError(error)) {
      throw createLocalOnlyCloudError();
    }
    throw error;
  }
}

export async function saveCoreState(
  client: Client,
  ownerId: string,
  state: AppState,
  syncMetadata?: SyncMetadata,
): Promise<void> {
  const classIdMap = new Map(state.classes.map((item) => [item.id, cloudId(ownerId, 'class', item.id)]));
  const studentIdMap = new Map(state.students.map((item) => [item.id, cloudId(ownerId, 'student', item.id)]));
  const classRows: Database['public']['Tables']['classes']['Insert'][] = state.classes.map((item) => ({
    id: classIdMap.get(item.id),
    owner_id: ownerId,
    name: item.name.trim(),
    level: item.level,
    section: item.stream || null,
    weekly_hours: item.level === '1AS_SCIENCE' ? 1 : 2,
    academic_year: state.profile.academicYear || null,
    notes: null,
  }));
  const studentRows: Database['public']['Tables']['students']['Insert'][] = state.students
    .filter((item) => state.classes.some((classItem) => classItem.id === item.classId))
    .map((item) => ({
      id: studentIdMap.get(item.id),
      owner_id: ownerId,
      class_id: classIdMap.get(item.classId)!,
      external_id: item.regNumber || item.registrationNumber || null,
      full_name: item.fullName.trim(),
      number_in_list: Math.max(1, item.numberInList),
      reg_number: item.regNumber || null,
      registration_number: item.registrationNumber || null,
      is_repeater: item.isRepeater ?? false,
      guardian_phone: item.guardianPhone || null,
      gender: item.gender === 'M' ? 'male' : item.gender === 'F' ? 'female' : null,
      birth_date: item.birthDate || null,
      notes: item.notes || null,
    }));
  const gradeRows: Database['public']['Tables']['grades']['Insert'][] = state.grades
    .filter((item) => studentIdMap.has(item.studentId) && classIdMap.has(item.classId))
    .map((item) => ({
      id: isUuid(item.id) ? item.id : stableUuid(`grade:${ownerId}:${item.studentId}:${item.trimester}`),
      owner_id: ownerId,
      student_id: studentIdMap.get(item.studentId)!,
      class_id: classIdMap.get(item.classId)!,
      trimester: item.trimester,
      continuous_eval: item.continuousEval,
      behavior_score: item.behaviorScore ?? null,
      attendance_score: item.attendanceScore ?? null,
      notebook_score: item.notebookScore ?? null,
      participation_score: item.participationScore ?? null,
      quiz: item.quiz,
      exam: item.exam,
      calculated_average: item.calculatedAverage ?? null,
      estimation: item.estimation || null,
      guidance: item.guidance || null,
      remarks: item.remarks || null,
      follow_up_notes: item.followUpNotes || null,
    }));

  try {
    const [existingClasses, existingStudents, existingGrades] = await Promise.all([
      client.from('classes').select('id').eq('owner_id', ownerId),
      client.from('students').select('id').eq('owner_id', ownerId),
      client.from('grades').select('id').eq('owner_id', ownerId),
    ]);
    if (existingClasses.error) throw existingClasses.error;
    if (existingStudents.error) throw existingStudents.error;
    if (existingGrades.error) throw existingGrades.error;

    const currentClassIds = new Set(classRows.map(row => row.id));
    const currentStudentIds = new Set(studentRows.map(row => row.id));
    const currentGradeIds = new Set(gradeRows.map(row => row.id));
    const staleClassIds = existingClasses.data
      .map(row => row.id)
      .filter(id => !currentClassIds.has(id));
    const staleStudentIds = existingStudents.data
      .map(row => row.id)
      .filter(id => !currentStudentIds.has(id));
    const staleGradeIds = existingGrades.data
      .map(row => row.id)
      .filter(id => !currentGradeIds.has(id));

    if (staleGradeIds.length > 0) {
      const result = await client.from('grades').delete().in('id', staleGradeIds).eq('owner_id', ownerId);
      if (result.error) throw result.error;
    }
    if (staleStudentIds.length > 0) {
      const result = await client.from('students').delete().in('id', staleStudentIds).eq('owner_id', ownerId);
      if (result.error) throw result.error;
    }
    if (staleClassIds.length > 0) {
      const result = await client.from('classes').delete().in('id', staleClassIds).eq('owner_id', ownerId);
      if (result.error) throw result.error;
    }

    const classesResult = await client.from('classes').upsert(classRows, { onConflict: 'id' });
    if (classesResult.error) throw classesResult.error;
    const studentsResult = await client.from('students').upsert(studentRows, { onConflict: 'id' });
    if (studentsResult.error) throw studentsResult.error;
    const gradesResult = await client.from('grades').upsert(gradeRows, { onConflict: 'id' });
    if (gradesResult.error) throw gradesResult.error;

    const settings = JSON.parse(JSON.stringify({
      profile: state.profile,
      timetable: state.timetable,
      sessions: state.sessions,
      lessonProgress: state.lessonProgress,
      customUnits: state.customUnits,
      lessonPlans: state.lessonPlans,
      unitPdfFiles: Object.fromEntries(
        Object.entries(state.unitPdfFiles || {}).map(([key, value]) => [
          key,
          { ...value, fileDataUrl: undefined },
        ]),
      ),
      calendarSettings: state.calendarSettings,
      theme: state.theme,
      dashboardStyle: state.dashboardStyle,
      sidebarCollapsed: state.sidebarCollapsed,
      onboardingDismissed: state.onboardingDismissed,
      syncMetadata: syncMetadata || null,
    })) as Database['public']['Tables']['app_settings']['Insert']['settings'];

    const { error: settingsError } = await client.from('app_settings').upsert({
      owner_id: ownerId,
      settings,
      revision: syncMetadata?.revision || 0,
      updated_by_device: syncMetadata?.deviceId || null,
    }, { onConflict: 'owner_id' });
    if (settingsError) throw settingsError;
  } catch (error) {
    if (isSchemaUnavailableError(error)) {
      throw createLocalOnlyCloudError();
    }
    throw error;
  }
}
