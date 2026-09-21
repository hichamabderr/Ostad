import { del, get, keys, set } from 'idb-keyval';
import type { AppState } from './storage';

export type SyncEntity =
  | 'class' | 'student' | 'grade' | 'session' | 'timetable'
  | 'lessonProgress' | 'customUnit' | 'lessonPlan' | 'attendance'
  | 'behavior' | 'dashboardTask' | 'profile' | 'settings';

export interface SyncOperation {
  id: string;
  entity: SyncEntity;
  action: 'upsert' | 'delete';
  recordId: string;
  payload?: unknown;
}

export interface SyncOutboxEntry {
  id: string;
  ownerId: string;
  revision: number;
  updatedAt: string;
  operations: SyncOperation[];
  createdAt: string;
  attempts?: number;
  nextAttemptAt?: string;
  lastError?: string;
}

export interface SyncConflictDescriptor {
  entity: SyncEntity;
  recordId: string;
  outboxId: string;
  operationId: string;
  localRevision: number;
  remoteRevision: number;
  localPayload?: unknown;
  remotePayload?: unknown;
}

const OUTBOX_PREFIX = 'sanad:sync-outbox:';
const DEVICE_ID_KEY = 'sanad:sync-device-id';
const outboxKey = (id: string) => `${OUTBOX_PREFIX}${id}`;

export function getSyncDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export function getSyncOperationsForState(state: AppState): SyncOperation[] {
  const collections: Array<[SyncEntity, Array<{ id: string }>, boolean]> = [
    ['class', state.classes, true], ['student', state.students, true], ['grade', state.grades, true],
    ['session', state.sessions, true], ['timetable', state.timetable, true],
    ['lessonProgress', state.lessonProgress, true], ['customUnit', state.customUnits, true],
    ['lessonPlan', state.lessonPlans, true],
  ];
  const operations: SyncOperation[] = collections.flatMap(([entity, records]) =>
    records.map(record => ({ id: `${entity}:${record.id}`, entity, action: 'upsert' as const, recordId: record.id, payload: record })),
  );
  for (const task of state.dashboardTasks || []) {
    operations.push({
      id: `dashboardTask:${task.id}`,
      entity: 'dashboardTask',
      action: 'upsert',
      recordId: task.id,
      payload: task,
    });
  }
  for (const session of state.sessions) {
    for (const [studentId, status] of Object.entries(session.attendance || {})) {
      const recordId = `${session.id}:${studentId}`;
      operations.push({
        id: `attendance:${recordId}`,
        entity: 'attendance',
        action: 'upsert',
        recordId,
        payload: { id: recordId, sessionId: session.id, studentId, status },
      });
    }
    for (const [behavior, studentIds] of [
      ['disruptions', session.disruptions || []],
      ['unwrittenLessons', session.unwrittenLessons || []],
      ['poorParticipation', session.poorParticipation || []],
      ['goodParticipation', session.goodParticipation || []],
    ] as const) {
      for (const studentId of studentIds) {
        const recordId = `${session.id}:${studentId}:${behavior}`;
        operations.push({
          id: `behavior:${recordId}`,
          entity: 'behavior',
          action: 'upsert',
          recordId,
          payload: { id: recordId, sessionId: session.id, studentId, behavior },
        });
      }
    }
  }
  operations.push({ id: 'profile:profile', entity: 'profile', action: 'upsert', recordId: 'profile', payload: state.profile });
  operations.push({
    id: 'settings:settings', entity: 'settings', action: 'upsert', recordId: 'settings',
    payload: {
      calendarSettings: state.calendarSettings, theme: state.theme, dashboardStyle: state.dashboardStyle,
      sidebarCollapsed: state.sidebarCollapsed, onboardingDismissed: state.onboardingDismissed,
      activeClassId: state.activeClassId, activeTrimester: state.activeTrimester,
    },
  });
  for (const tombstone of state.deletedRecordIds || []) {
    const separator = tombstone.indexOf(':');
    if (separator <= 0) continue;
    const entity = tombstone.slice(0, separator) as SyncEntity;
    const recordId = tombstone.slice(separator + 1);
    const relationalEntity = entity === 'attendance' || entity === 'behavior' || entity === 'dashboardTask';
    if ((!collections.some(([kind]) => kind === entity) && !relationalEntity) || !recordId) continue;
    operations.push({ id: `delete:${entity}:${recordId}`, entity, action: 'delete', recordId });
  }
  return operations;
}

export function recordsShallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    const valA = objA[k];
    const valB = objB[k];
    if (valA === valB) continue;
    if (valA !== null && typeof valA === 'object' && valB !== null && typeof valB === 'object') {
      if (JSON.stringify(valA) !== JSON.stringify(valB)) return false;
    } else {
      return false;
    }
  }
  return true;
}

export function getSyncOperationsDelta(
  previousState: AppState | null | undefined,
  nextState: AppState,
): SyncOperation[] {
  if (!previousState) {
    return getSyncOperationsForState(nextState);
  }

  const operations: SyncOperation[] = [];

  const prevClasses = new Map(previousState.classes.map((c) => [c.id, c]));
  for (const c of nextState.classes) {
    const prev = prevClasses.get(c.id);
    if (!prev || !recordsShallowEqual(prev, c)) {
      operations.push({ id: `class:${c.id}`, entity: 'class', action: 'upsert', recordId: c.id, payload: c });
    }
  }

  const prevStudents = new Map(previousState.students.map((s) => [s.id, s]));
  for (const s of nextState.students) {
    const prev = prevStudents.get(s.id);
    if (!prev || !recordsShallowEqual(prev, s)) {
      operations.push({ id: `student:${s.id}`, entity: 'student', action: 'upsert', recordId: s.id, payload: s });
    }
  }

  const prevGrades = new Map(previousState.grades.map((g) => [g.id, g]));
  for (const g of nextState.grades) {
    const prev = prevGrades.get(g.id);
    if (!prev || !recordsShallowEqual(prev, g)) {
      operations.push({ id: `grade:${g.id}`, entity: 'grade', action: 'upsert', recordId: g.id, payload: g });
    }
  }

  const prevTimetable = new Map(previousState.timetable.map((t) => [t.id, t]));
  for (const t of nextState.timetable) {
    const prev = prevTimetable.get(t.id);
    if (!prev || !recordsShallowEqual(prev, t)) {
      operations.push({ id: `timetable:${t.id}`, entity: 'timetable', action: 'upsert', recordId: t.id, payload: t });
    }
  }

  const prevProgress = new Map(previousState.lessonProgress.map((p) => [p.id, p]));
  for (const p of nextState.lessonProgress) {
    const prev = prevProgress.get(p.id);
    if (!prev || !recordsShallowEqual(prev, p)) {
      operations.push({ id: `lessonProgress:${p.id}`, entity: 'lessonProgress', action: 'upsert', recordId: p.id, payload: p });
    }
  }

  const prevCustomUnits = new Map(previousState.customUnits.map((u) => [u.id, u]));
  for (const u of nextState.customUnits) {
    const prev = prevCustomUnits.get(u.id);
    if (!prev || !recordsShallowEqual(prev, u)) {
      operations.push({ id: `customUnit:${u.id}`, entity: 'customUnit', action: 'upsert', recordId: u.id, payload: u });
    }
  }

  const prevPlans = new Map(previousState.lessonPlans.map((p) => [p.id, p]));
  for (const p of nextState.lessonPlans) {
    const prev = prevPlans.get(p.id);
    if (!prev || !recordsShallowEqual(prev, p)) {
      operations.push({ id: `lessonPlan:${p.id}`, entity: 'lessonPlan', action: 'upsert', recordId: p.id, payload: p });
    }
  }

  const prevTasks = new Map((previousState.dashboardTasks || []).map((t) => [t.id, t]));
  for (const t of nextState.dashboardTasks || []) {
    const prev = prevTasks.get(t.id);
    if (!prev || !recordsShallowEqual(prev, t)) {
      operations.push({ id: `dashboardTask:${t.id}`, entity: 'dashboardTask', action: 'upsert', recordId: t.id, payload: t });
    }
  }

  const prevSessions = new Map(previousState.sessions.map((s) => [s.id, s]));
  for (const s of nextState.sessions) {
    const prev = prevSessions.get(s.id);
    if (!prev || !recordsShallowEqual(prev, s)) {
      operations.push({ id: `session:${s.id}`, entity: 'session', action: 'upsert', recordId: s.id, payload: s });
    }

    for (const [studentId, status] of Object.entries(s.attendance || {})) {
      if (!prev || prev.attendance?.[studentId] !== status) {
        const recordId = `${s.id}:${studentId}`;
        operations.push({
          id: `attendance:${recordId}`,
          entity: 'attendance',
          action: 'upsert',
          recordId,
          payload: { id: recordId, sessionId: s.id, studentId, status },
        });
      }
    }

    for (const [behavior, studentIds] of [
      ['disruptions', s.disruptions || []],
      ['unwrittenLessons', s.unwrittenLessons || []],
      ['poorParticipation', s.poorParticipation || []],
      ['goodParticipation', s.goodParticipation || []],
    ] as const) {
      const prevStudentIds = new Set(prev?.[behavior] || []);
      for (const studentId of studentIds) {
        if (!prev || !prevStudentIds.has(studentId)) {
          const recordId = `${s.id}:${studentId}:${behavior}`;
          operations.push({
            id: `behavior:${recordId}`,
            entity: 'behavior',
            action: 'upsert',
            recordId,
            payload: { id: recordId, sessionId: s.id, studentId, behavior },
          });
        }
      }
    }
  }

  if (!recordsShallowEqual(previousState.profile, nextState.profile)) {
    operations.push({ id: 'profile:profile', entity: 'profile', action: 'upsert', recordId: 'profile', payload: nextState.profile });
  }

  const prevSettings = {
    calendarSettings: previousState.calendarSettings,
    theme: previousState.theme,
    dashboardStyle: previousState.dashboardStyle,
    sidebarCollapsed: previousState.sidebarCollapsed,
    onboardingDismissed: previousState.onboardingDismissed,
    activeClassId: previousState.activeClassId,
    activeTrimester: previousState.activeTrimester,
  };
  const nextSettings = {
    calendarSettings: nextState.calendarSettings,
    theme: nextState.theme,
    dashboardStyle: nextState.dashboardStyle,
    sidebarCollapsed: nextState.sidebarCollapsed,
    onboardingDismissed: nextState.onboardingDismissed,
    activeClassId: nextState.activeClassId,
    activeTrimester: nextState.activeTrimester,
  };
  if (!recordsShallowEqual(prevSettings, nextSettings)) {
    operations.push({ id: 'settings:settings', entity: 'settings', action: 'upsert', recordId: 'settings', payload: nextSettings });
  }

  const collectionsToCheck: [SyncEntity, { id: string }[], { id: string }[]][] = [
    ['class', previousState.classes, nextState.classes],
    ['student', previousState.students, nextState.students],
    ['grade', previousState.grades, nextState.grades],
    ['session', previousState.sessions, nextState.sessions],
    ['timetable', previousState.timetable, nextState.timetable],
    ['lessonProgress', previousState.lessonProgress, nextState.lessonProgress],
    ['customUnit', previousState.customUnits, nextState.customUnits],
    ['lessonPlan', previousState.lessonPlans, nextState.lessonPlans],
    ['dashboardTask', previousState.dashboardTasks || [], nextState.dashboardTasks || []],
  ];

  const addedDeleteIds = new Set<string>();

  for (const [entity, prevItems, nextItems] of collectionsToCheck) {
    const nextIds = new Set(nextItems.map((item) => item.id));
    for (const item of prevItems) {
      if (!nextIds.has(item.id)) {
        const id = `delete:${entity}:${item.id}`;
        addedDeleteIds.add(id);
        operations.push({ id, entity, action: 'delete', recordId: item.id });
      }
    }
  }

  const nextSessionsMap = new Map(nextState.sessions.map((s) => [s.id, s]));
  for (const prevSession of previousState.sessions) {
    const nextSession = nextSessionsMap.get(prevSession.id);
    if (!nextSession) continue;

    for (const studentId of Object.keys(prevSession.attendance || {})) {
      if (!(studentId in (nextSession.attendance || {}))) {
        const recordId = `${prevSession.id}:${studentId}`;
        const id = `delete:attendance:${recordId}`;
        if (!addedDeleteIds.has(id)) {
          addedDeleteIds.add(id);
          operations.push({ id, entity: 'attendance', action: 'delete', recordId });
        }
      }
    }

    for (const behavior of [
      'disruptions',
      'unwrittenLessons',
      'poorParticipation',
      'goodParticipation',
    ] as const) {
      const nextStudentIds = new Set(nextSession[behavior] || []);
      for (const studentId of prevSession[behavior] || []) {
        if (!nextStudentIds.has(studentId)) {
          const recordId = `${prevSession.id}:${studentId}:${behavior}`;
          const id = `delete:behavior:${recordId}`;
          if (!addedDeleteIds.has(id)) {
            addedDeleteIds.add(id);
            operations.push({ id, entity: 'behavior', action: 'delete', recordId });
          }
        }
      }
    }
  }

  const collections: SyncEntity[] = [
    'class', 'student', 'grade', 'session', 'timetable',
    'lessonProgress', 'customUnit', 'lessonPlan', 'attendance',
    'behavior', 'dashboardTask',
  ];
  for (const tombstone of nextState.deletedRecordIds || []) {
    const separator = tombstone.indexOf(':');
    if (separator <= 0) continue;
    const entity = tombstone.slice(0, separator) as SyncEntity;
    const recordId = tombstone.slice(separator + 1);
    if (!collections.includes(entity) || !recordId) continue;
    const id = `delete:${entity}:${recordId}`;
    if (!addedDeleteIds.has(id)) {
      addedDeleteIds.add(id);
      operations.push({ id, entity, action: 'delete', recordId });
    }
  }

  return operations;
}

/** Compatibility wrapper: it now stores row operations, never a whole snapshot. */
export async function enqueueSyncState(ownerId: string, state: AppState, revision: number, updatedAt: string): Promise<string> {
  return enqueueSyncOperations(ownerId, getSyncOperationsForState(state), revision, updatedAt);
}

export async function enqueueSyncDelta(
  ownerId: string,
  previousState: AppState | null | undefined,
  nextState: AppState,
  revision: number,
  updatedAt: string,
): Promise<string | null> {
  const operations = getSyncOperationsDelta(previousState, nextState);
  if (operations.length === 0) {
    return null;
  }
  return enqueueSyncOperations(ownerId, operations, revision, updatedAt);
}

export async function enqueueSyncOperations(
  ownerId: string, operations: SyncOperation[], revision: number, updatedAt: string,
): Promise<string> {
  const id = `${ownerId}:${getSyncDeviceId()}:${revision}:${updatedAt}`;
  await set(outboxKey(id), {
    id, ownerId, revision, updatedAt, operations, createdAt: new Date().toISOString(),
    attempts: 0, nextAttemptAt: new Date().toISOString(),
  } satisfies SyncOutboxEntry);
  return id;
}

export async function listSyncOutbox(ownerId: string): Promise<SyncOutboxEntry[]> {
  const entries = await Promise.all((await keys())
    .filter((key): key is string => typeof key === 'string' && key.startsWith(OUTBOX_PREFIX))
    .map(key => get<SyncOutboxEntry>(key)));
  return entries.filter((entry): entry is SyncOutboxEntry => {
    if (!entry || entry.ownerId !== ownerId) return false;
    // Read old entries once and convert them in memory; new entries never contain snapshots.
    const legacy = entry as SyncOutboxEntry & { state?: AppState };
    if (!entry.operations && legacy.state) entry.operations = getSyncOperationsForState(legacy.state);
    if (!Array.isArray(entry.operations)) return false;
    entry.attempts ??= 0;
    entry.nextAttemptAt ??= entry.createdAt;
    return true;
  })
    .sort((a, b) => a.revision - b.revision);
}

export function syncRetryDelay(attempts: number): number {
  return Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attempts, 8));
}

export async function markSyncOutboxFailure(id: string, error: unknown): Promise<void> {
  const entry = (await get<SyncOutboxEntry>(outboxKey(id)));
  if (!entry) return;
  const attempts = (entry.attempts ?? 0) + 1;
  entry.attempts = attempts;
  entry.nextAttemptAt = new Date(Date.now() + syncRetryDelay(attempts)).toISOString();
  entry.lastError = error instanceof Error ? error.message : String(error);
  await set(outboxKey(id), entry);
}

export async function removeSyncOutboxEntry(id: string): Promise<void> { await del(outboxKey(id)); }
export async function clearSyncOutbox(ownerId: string): Promise<void> {
  await Promise.all((await listSyncOutbox(ownerId)).map(entry => removeSyncOutboxEntry(entry.id)));
}
