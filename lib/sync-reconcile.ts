/**
 * The single place that decides what survives a merge. (SYNC-REVIEW.md §5.1)
 *
 * Contract, in one sentence: **Postgres is authoritative; a local record survives only when
 * the outbox still holds unacknowledged work for it and no tombstone marks it deleted.**
 *
 * Before this module the rule was re-implemented per entity inside `loadCoreState` — plus a
 * second, slightly different copy for attendance and behaviours — and every refresh path
 * (initial load, Realtime, retry, restore, full re-sync) went through its own variant. Now
 * they all call these two functions, so "same input, same decision" is a property of the code
 * rather than of reviewer diligence.
 */

export type ReconciliationEntity =
  | 'class' | 'student' | 'grade' | 'session' | 'timetable'
  | 'lessonProgress' | 'customUnit' | 'lessonPlan' | 'dashboardTask'
  | 'attendance' | 'behavior' | 'profile' | 'settings';

export interface ReconciliationContext {
  /**
   * Cloud-side id for a local id. Local ids are stable (`local-*`), so the comparison against
   * the remote list has to consider both spellings.
   */
  cloudIdFor: (entity: ReconciliationEntity, localId: string) => string;
  /** `entity:recordId` keys that still have queued (unacknowledged) work. */
  pendingRecordIds?: ReadonlySet<string>;
  /** `entity:recordId` keys deleted in this session but not yet acknowledged. */
  deletedRecordIds?: readonly string[];
  /** `entity:recordId` keys the server reports as deleted. */
  tombstonedKeys?: Set<string>;
}

export function isPending(context: ReconciliationContext, entity: ReconciliationEntity, recordId: string): boolean {
  return Boolean(context.pendingRecordIds?.has(`${entity}:${recordId}`));
}

export function isDeletedLocally(context: ReconciliationContext, entity: ReconciliationEntity, recordId: string): boolean {
  return Boolean(context.deletedRecordIds?.includes(`${entity}:${recordId}`));
}

export function isTombstoned(
  context: ReconciliationContext,
  entity: ReconciliationEntity,
  ...recordIds: string[]
): boolean {
  if (!context.tombstonedKeys?.size) return false;
  return recordIds.some((recordId) => context.tombstonedKeys!.has(`${entity}:${recordId}`));
}

/**
 * Remote rows win. A local row is appended only when all three hold:
 *   1. it is not already represented in the remote list (by local or cloud id),
 *   2. it is not marked deleted locally or by a server tombstone,
 *   3. the outbox still proves it has unsynced work.
 *
 * Rule 3 is what stops a stale cache from resurrecting records the teacher deleted on another
 * device: a row that exists only locally and has nothing queued is, by definition, a ghost.
 */
export function reconcileEntityList<T extends { id: string }>(
  entity: ReconciliationEntity,
  remoteItems: T[],
  localItems: T[] | undefined,
  context: ReconciliationContext,
): T[] {
  if (!localItems?.length) return remoteItems;

  const remoteIds = new Set(remoteItems.map((item) => item.id));
  const retained = localItems.filter((item) => {
    const cloudId = context.cloudIdFor(entity, item.id);
    if (remoteIds.has(item.id) || remoteIds.has(cloudId)) return false;
    if (isDeletedLocally(context, entity, item.id)) return false;
    if (isTombstoned(context, entity, cloudId, item.id)) return false;
    return isPending(context, entity, item.id);
  });

  return retained.length > 0 ? [...remoteItems, ...retained] : remoteItems;
}

/** The behaviour columns a session carries, in the shape the sync engine stores. */
export const BEHAVIOR_FIELDS = [
  'disruptions',
  'unwrittenLessons',
  'poorParticipation',
  'goodParticipation',
] as const;

export type BehaviorField = (typeof BEHAVIOR_FIELDS)[number];

export interface SessionMarksLike {
  id: string;
  attendance?: Record<string, string> | null;
  disruptions?: string[] | null;
  unwrittenLessons?: string[] | null;
  poorParticipation?: string[] | null;
  goodParticipation?: string[] | null;
}

export interface AttendanceRow {
  session_id: string;
  student_id: string;
  status?: string | null;
}

export interface BehaviorRow {
  session_id: string;
  student_id: string;
  behavior: string;
}

export interface ReconciledSession {
  /** Marks that override the cloud rows because the outbox still holds them. */
  pendingAttendance: Map<string, Set<string>>;
  pendingBehaviors: Map<string, Set<string>>;
}

const ATTENDANCE_STATUSES: Record<string, string> = {
  absent: 'ABSENT',
  late: 'LATE',
  excused: 'EXCUSED',
  present: 'PRESENT',
};

/**
 * Attendance and behaviours are relational on the server but embedded in the session on the
 * client, so they need their own pass: the cloud rows are applied first and a local mark is
 * kept only when it is still pending. Without this, a mark taken offline was silently dropped
 * by the next cloud load (and a mark deleted offline was silently restored).
 *
 * Mutates `remoteSessions` in place and reports which marks it kept as pending overrides.
 */
export function reconcileSessionMarks(
  remoteSessions: SessionMarksLike[],
  localSessionsById: Map<string, SessionMarksLike>,
  attendanceRows: AttendanceRow[],
  behaviorRows: BehaviorRow[],
  context: ReconciliationContext,
): ReconciledSession {
  const pendingAttendance = new Map<string, Set<string>>();
  const pendingBehaviors = new Map<string, Set<string>>();
  const sessionsById = new Map(remoteSessions.map((session) => [session.id, session]));

  for (const session of remoteSessions) {
    // Start from the cloud's empty baseline, then re-apply only what is still queued.
    session.attendance = {};
    for (const field of BEHAVIOR_FIELDS) session[field] = [];
    const local = localSessionsById.get(session.id);
    if (!local) continue;

    const attendanceIds = new Set<string>();
    for (const [studentId, status] of Object.entries(local.attendance || {})) {
      if (!status) continue;
      if (isPending(context, 'attendance', `${session.id}:${studentId}`)) {
        session.attendance[studentId] = status;
        attendanceIds.add(studentId);
      }
    }

    const behaviorIds = new Set<string>();
    for (const field of BEHAVIOR_FIELDS) {
      const target = session[field];
      if (!target) continue;
      for (const studentId of local[field] || []) {
        if (isPending(context, 'behavior', `${session.id}:${studentId}:${field}`)) {
          if (!target.includes(studentId)) target.push(studentId);
          behaviorIds.add(`${studentId}:${field}`);
        }
      }
    }

    pendingAttendance.set(session.id, attendanceIds);
    pendingBehaviors.set(session.id, behaviorIds);
  }

  for (const row of attendanceRows) {
    const session = sessionsById.get(row.session_id);
    if (!session) continue;
    if (pendingAttendance.get(session.id)?.has(row.student_id)) continue;
    session.attendance ??= {};
    session.attendance[row.student_id] = ATTENDANCE_STATUSES[row.status || 'present'] ?? 'PRESENT';
  }

  for (const row of behaviorRows) {
    const session = sessionsById.get(row.session_id);
    if (!session) continue;
    if (pendingBehaviors.get(session.id)?.has(`${row.student_id}:${row.behavior}`)) continue;
    const field = BEHAVIOR_FIELDS.find((candidate) => candidate === row.behavior);
    if (!field) continue;
    const target = (session[field] ??= []);
    if (!target.includes(row.student_id)) target.push(row.student_id);
  }

  return { pendingAttendance, pendingBehaviors };
}
