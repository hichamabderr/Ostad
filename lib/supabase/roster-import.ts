import { createSupabaseBrowserClient } from './browser';
import type { GradeLevel, Student } from '@/lib/types';

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
    throw new Error('تعذر الوصول إلى Supabase لتأكيد استيراد القوائم.');
  }
  const { error } = await (client as unknown as {
    rpc: (name: 'import_roster_batch', args: {
      p_classes: RosterImportClass[];
      p_students: RosterImportStudent[];
    }) => Promise<{ error: Error | null }>;
  }).rpc('import_roster_batch', {
    p_classes: classes,
    p_students: students,
  });
  if (error) throw error;
}
