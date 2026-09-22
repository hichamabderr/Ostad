import { createSupabaseBrowserClient } from './browser';
import type { GradeLevel, Student } from '@/lib/types';
import { normalizeDateToIso } from '@/lib/date-utils';
import { getCloudRecordId } from './core-sync';
import { getWeeklyHours } from '@/lib/curriculum-data';

export interface RosterImportClass {
  id: string;
  name: string;
  level: GradeLevel;
  stream: string;
}

export interface RosterImportStudent extends Omit<Student, 'classId'> {
  classId: string;
}

export async function commitRosterImportBatch(
  classes: RosterImportClass[],
  students: RosterImportStudent[],
): Promise<void> {
  if (classes.length === 0) return;
  const client = createSupabaseBrowserClient();
  if (!client) {
    throw new Error('تعذر الوصول إلى الخادم السحابي لتأكيد استيراد القوائم.');
  }

  const { data: authData } = await client.auth.getUser();
  const userId = authData.user?.id;
  if (!userId) {
    throw new Error('يجب تسجيل الدخول لتأكيد استيراد القوائم في السحابة.');
  }

  const mappedClasses = classes.map((c) => ({
    id: getCloudRecordId(userId, 'class', c.id),
    name: c.name.trim(),
    level: c.level,
    stream: c.stream || '',
    section: c.stream || '',
  }));

  const mappedStudents = students.map((s) => ({
    id: getCloudRecordId(userId, 'student', s.id),
    class_id: getCloudRecordId(userId, 'class', s.classId),
    classId: getCloudRecordId(userId, 'class', s.classId),
    full_name: s.fullName.trim(),
    fullName: s.fullName.trim(),
    number_in_list: s.numberInList,
    numberInList: s.numberInList,
    reg_number: s.regNumber || null,
    registration_number: s.registrationNumber || s.regNumber || null,
    gender: s.gender === 'M' ? 'M' : s.gender === 'F' ? 'F' : null,
    birth_date: normalizeDateToIso(s.birthDate) || null,
    is_repeater: Boolean(s.isRepeater),
    guardian_phone: s.guardianPhone || null,
    notes: s.notes || null,
  }));

  try {
    const rpcResult = await (client as unknown as {
      rpc: (name: 'import_roster_batch', args: {
        p_classes: unknown[];
        p_students: unknown[];
      }) => Promise<{ error: Error | null }>;
    }).rpc('import_roster_batch', {
      p_classes: mappedClasses,
      p_students: mappedStudents,
    });
    if (!rpcResult.error) return;
    console.warn('RPC import_roster_batch returned error, falling back to direct batch upsert:', rpcResult.error);
  } catch (rpcErr) {
    console.warn('RPC import_roster_batch threw, falling back to direct batch upsert:', rpcErr);
  }

  // Resilient Direct Table Upsert Fallback
  const widResult = await (client as any).rpc('default_workspace_id');
  const wid = typeof widResult.data === 'string' ? widResult.data : null;

  const dbClasses = mappedClasses.map((c) => ({
    id: c.id,
    workspace_id: wid,
    owner_id: userId,
    name: c.name,
    level: c.level,
    section: c.section || null,
    weekly_hours: getWeeklyHours(c.level),
    updated_by: userId,
  }));
  const { error: classesErr } = await (client as any)
    .from('classes')
    .upsert(dbClasses, { onConflict: 'workspace_id,id' });
  if (classesErr) throw classesErr;

  const dbStudents = mappedStudents.map((s) => ({
    id: s.id,
    workspace_id: wid,
    owner_id: userId,
    class_id: s.class_id,
    full_name: s.full_name,
    number_in_list: s.number_in_list,
    reg_number: s.reg_number,
    registration_number: s.registration_number,
    gender: s.gender === 'M' ? 'male' : s.gender === 'F' ? 'female' : null,
    birth_date: s.birth_date,
    is_repeater: s.is_repeater,
    guardian_phone: s.guardian_phone,
    notes: s.notes,
    updated_by: userId,
  }));

  for (let i = 0; i < dbStudents.length; i += 100) {
    const chunk = dbStudents.slice(i, i + 100);
    const { error: studentsErr } = await (client as any)
      .from('students')
      .upsert(chunk, { onConflict: 'workspace_id,id' });
    if (studentsErr) throw studentsErr;
  }
}
