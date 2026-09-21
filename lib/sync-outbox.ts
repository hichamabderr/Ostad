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

/** Compatibility wrapper: it now stores row operations, never a whole snapshot. */
export async function enqueueSyncState(ownerId: string, state: AppState, revision: number, updatedAt: string): Promise<string> {
  return enqueueSyncOperations(ownerId, getSyncOperationsForState(state), revision, updatedAt);
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
