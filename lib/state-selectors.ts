import type { AppState } from './storage';

export function selectActiveClassId(state: AppState): string | null {
  if (state.activeClassId && state.classes.some((item) => item.id === state.activeClassId)) {
    return state.activeClassId;
  }
  return state.classes[0]?.id ?? null;
}

export function selectActiveClass(state: AppState) {
  const activeClassId = selectActiveClassId(state);
  return state.classes.find((item) => item.id === activeClassId) ?? null;
}

export function selectStudentsByClass(state: AppState, classId: string | null) {
  return classId ? state.students.filter((student) => student.classId === classId) : [];
}

export function selectSessionsByClass(state: AppState, classId: string | null) {
  return classId ? state.sessions.filter((session) => session.classId === classId) : [];
}

export function selectTimetableByClass(state: AppState, classId: string | null) {
  return classId ? state.timetable.filter((slot) => slot.classId === classId) : [];
}

export function selectLessonProgressByClass(state: AppState, classId: string | null) {
  return classId ? state.lessonProgress.filter((progress) => progress.classId === classId) : [];
}
