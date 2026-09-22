import { createSupabaseBrowserClient } from './browser';
import type { GradeLevel, Student } from '@/lib/types';
import { normalizeDateToIso } from '@/lib/date-utils';

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

  const mappedClasses = classes.map((c) => ({
    id: c.id,
    name: c.name.trim(),
    level: c.level,
    stream: c.stream || '',
    section: c.stream || '',
  }));

  const mappedStudents = students.map((s) => ({
    id: s.id,
    class_id: s.classId,
    classId: s.classId,
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

  const { error } = await (client as unknown as {
    rpc: (name: 'import_roster_batch', args: {
      p_classes: unknown[];
      p_students: unknown[];
    }) => Promise<{ error: Error | null }>;
  }).rpc('import_roster_batch', {
    p_classes: mappedClasses,
    p_students: mappedStudents,
  });
  if (error) throw error;
}
