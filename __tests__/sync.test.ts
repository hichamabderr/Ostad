import { beforeEach, describe, expect, it, vi } from 'vitest';

const idb = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    del: vi.fn(async (key: string) => values.delete(key)),
    get: vi.fn(async <T>(key: string) => values.get(key) as T | undefined),
    keys: vi.fn(async () => [...values.keys()]),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
  };
});

vi.mock('idb-keyval', () => idb);

import { getEmptyState } from '@/lib/storage';
import {
  selectActiveClass,
  selectActiveClassId,
  selectStudentsByClass,
} from '@/lib/state-selectors';
import { getSyncOperationsForState } from '@/lib/sync-outbox';
import { getDeletedRecordIds } from '@/hooks/useCloudAppState';
import {
  applySyncOutboxEntry,
  getCloudRecordId,
  SyncConflictError,
} from '@/lib/supabase/core-sync';
import {
  enqueueSyncState,
  enqueueSyncOperations,
  listSyncOutbox,
  type SyncOperation,
  type SyncOutboxEntry,
} from '@/lib/sync-outbox';

describe('sync outbox', () => {
  it('resolves shared state slices with a safe active class fallback', () => {
    const state = getEmptyState();
    state.classes = [
      { ...state.classes[0], id: 'class-1', name: 'الأولى' },
      { ...state.classes[0], id: 'class-2', name: 'الثانية' },
    ];
    state.students = [
      { ...state.students[0], id: 'student-1', classId: 'class-2' },
    ];
    state.activeClassId = 'missing-class';

    expect(selectActiveClassId(state)).toBe('class-1');
    expect(selectActiveClass(state)?.name).toBe('الأولى');
    expect(selectStudentsByClass(state, 'class-2')).toHaveLength(1);
  });

  beforeEach(() => {
    idb.values.clear();
    vi.clearAllMocks();
  });

  it('stores row operations rather than a whole state snapshot', async () => {
    const state = getEmptyState();
    state.classes = [{ id: 'local-class', name: '1 علوم', level: '1AS_SCIENCE', stream: '' }];
    state.deletedRecordIds = ['student:deleted-row'];

    const id = await enqueueSyncState('owner-1', state, 4, '2026-09-20T20:00:00.000Z');
    const [entry] = await listSyncOutbox('owner-1');

    expect(entry.id).toBe(id);
    expect(entry).not.toHaveProperty('state');
    expect(entry.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'class:local-class',
          entity: 'class',
          action: 'upsert',
          recordId: 'local-class',
          payload: expect.objectContaining({ id: 'local-class' }),
        }),
        expect.objectContaining({
          id: 'delete:student:deleted-row',
          entity: 'student',
          action: 'delete',
          recordId: 'deleted-row',
        }),
      ]),
    );
    expect(entry.operations.every((operation) => !('state' in operation))).toBe(true);
  });

  it('synchronizes dashboard tasks as first-class row operations', async () => {
    const state = getEmptyState();
    state.dashboardTasks = [{ id: 'task-1', text: 'مراجعة دفتر النصوص', done: false }];

    const operations = getSyncOperationsForState(state);

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity: 'dashboardTask',
        action: 'upsert',
        recordId: 'task-1',
        payload: { id: 'task-1', text: 'مراجعة دفتر النصوص', done: false },
      }),
    ]));
  });

  it('emits a tombstone when a dashboard task is deleted', async () => {
    const previous = getEmptyState();
    previous.dashboardTasks = [{ id: 'task-1', text: 'مهمة', done: false }];
    const next = { ...previous, dashboardTasks: [], deletedRecordIds: ['dashboardTask:task-1'] };

    const operations = getSyncOperationsForState(next);

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity: 'dashboardTask',
        action: 'delete',
        recordId: 'task-1',
      }),
    ]));
  });

  it('keeps backup replacement deletions explicit for cloud synchronization', () => {
    const previous = getEmptyState();
    previous.classes = [{ id: 'class-1', name: 'قسم', level: '1AS_SCIENCE', stream: '' }];
    previous.dashboardTasks = [{ id: 'task-1', text: 'مهمة', done: false }];
    const next = getEmptyState();

    expect(getDeletedRecordIds(previous, next)).toEqual(
      expect.arrayContaining(['class:class-1', 'dashboardTask:task-1']),
    );
  });

  it('does not emit cross-table deletes for an entity-specific tombstone', async () => {
    const state = getEmptyState();
    state.deletedRecordIds = ['student:shared-id'];

    await enqueueSyncState('owner-1', state, 5, '2026-09-20T20:01:00.000Z');
    const [entry] = await listSyncOutbox('owner-1');

    expect(entry.operations.filter((operation) => operation.action === 'delete')).toEqual([
      expect.objectContaining({
        entity: 'student',
        recordId: 'shared-id',
      }),
    ]);
  });

  it('emits relational attendance and behavior operations from session records', async () => {
    const state = getEmptyState();
    state.sessions = [{
      id: 'session-1',
      classId: 'class-1',
      date: '2026-09-20',
      startTime: '08:00',
      endTime: '09:00',
      sessionGoals: '',
      accomplishments: '',
      nextSteps: '',
      teacherNotes: '',
      attendance: { 'student-1': 'ABSENT' },
      disruptions: ['student-2'],
      unwrittenLessons: [],
      poorParticipation: [],
      goodParticipation: ['student-3'],
    }];

    await enqueueSyncState('owner-1', state, 6, '2026-09-20T20:02:00.000Z');
    const [entry] = await listSyncOutbox('owner-1');

    expect(entry.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: 'attendance', recordId: 'session-1:student-1' }),
      expect.objectContaining({ entity: 'behavior', recordId: 'session-1:student-2:disruptions' }),
      expect.objectContaining({ entity: 'behavior', recordId: 'session-1:student-3:goodParticipation' }),
    ]));
  });

  it('preserves relational tombstones when attendance or behavior is removed', () => {
    const state = getEmptyState();
    state.deletedRecordIds = [
      'attendance:session-1:student-1',
      'behavior:session-1:student-2:disruptions',
    ];

    const operations = getSyncOperationsForState(state);

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entity: 'attendance',
        action: 'delete',
        recordId: 'session-1:student-1',
      }),
      expect.objectContaining({
        entity: 'behavior',
        action: 'delete',
        recordId: 'session-1:student-2:disruptions',
      }),
    ]));
  });

  it('uses stable cloud IDs for relational attendance references', () => {
    expect(getCloudRecordId('owner-1', 'session', 'session-1')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(getCloudRecordId('owner-1', 'student', 'student-1')).toBe(
      getCloudRecordId('owner-1', 'student', 'student-1'),
    );
  });

  it('includes the complete professional profile in the sync payload contract', () => {
    const state = getEmptyState();
    state.profile = {
      ...state.profile,
      title: 'أستاذ',
      stateName: 'تلمسان',
      academicYear: '2026/2027',
      firstNameAr: 'محمد',
      lastNameAr: 'بن صالح',
      firstAppointmentDate: '2020-09-01',
      gender: 'M',
    };
    const profileOperation = getSyncOperationsForState(state).find((operation) => operation.entity === 'profile');
    expect(profileOperation?.payload).toMatchObject({
      title: 'أستاذ',
      stateName: 'تلمسان',
      academicYear: '2026/2027',
      firstNameAr: 'محمد',
    });
  });

  it('keeps unit references portable without invalid foreign keys', () => {
    const state = getEmptyState();
    state.lessonProgress = [{
      id: 'progress-1',
      classId: 'class-1',
      unitId: 'official-unit-1',
      status: 'COMPLETED',
      completedAt: '2026-09-20T20:00:00.000Z',
    }];
    const operation = getSyncOperationsForState(state).find((item) => item.entity === 'lessonProgress');
    expect(operation?.payload).toMatchObject({ unitId: 'official-unit-1' });
  });
});

describe('core sync', () => {
  const ownerId = 'owner-1';
  const deviceId = 'device-1';
  const workspaceId = '11111111-1111-4111-8111-111111111111';

  function clientFor(options: {
    existing?: Record<string, unknown> | null;
    operationError?: Error;
  } = {}) {
    const calls: Array<{ table: string; method: string; value?: unknown }> = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: ownerId } } }) },
      rpc: async () => ({ data: workspaceId, error: null }),
      from(table: string) {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: table === 'sync_operations' ? null : options.existing ?? null,
            error: null,
          }),
          insert: async (value: unknown) => {
            calls.push({ table, method: 'insert', value });
            return { error: null };
          },
          upsert: async (value: unknown) => {
            calls.push({ table, method: 'upsert', value });
            return { error: options.operationError ?? null };
          },
          delete: async () => {
            calls.push({ table, method: 'delete' });
            return { error: options.operationError ?? null };
          },
        };
        return chain;
      },
    };
    return { client, calls };
  }

  it('maps local IDs deterministically and keeps mappings owner/entity scoped', () => {
    const first = getCloudRecordId(ownerId, 'class', 'local-class');
    expect(first).toBe(getCloudRecordId(ownerId, 'class', 'local-class'));
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toBe(getCloudRecordId('owner-2', 'class', 'local-class'));
    expect(first).not.toBe(getCloudRecordId(ownerId, 'student', 'local-class'));

    const uuid = '22222222-2222-4222-8222-222222222222';
    expect(getCloudRecordId(ownerId, 'class', uuid)).toBe(uuid);
  });

  it('applies a row operation, not a snapshot, with the deterministic cloud ID', async () => {
    const { client, calls } = clientFor();
    const operation: SyncOperation = {
      id: 'class:local-class',
      entity: 'class',
      action: 'upsert',
      recordId: 'local-class',
      payload: { id: 'local-class', name: '  1 علوم  ', level: '1AS_SCIENCE', stream: '' },
    };
    const entry: SyncOutboxEntry = {
      id: 'entry-1',
      ownerId,
      revision: 7,
      updatedAt: '2026-09-20T20:00:00.000Z',
      operations: [operation],
      createdAt: '2026-09-20T20:00:00.000Z',
    };

    await applySyncOutboxEntry(client as never, ownerId, entry, deviceId);

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('classes');
    expect(calls[0].method).toBe('upsert');
    expect(calls[0].value).toEqual(expect.objectContaining({
      id: getCloudRecordId(ownerId, 'class', 'local-class'),
      name: '1 علوم',
      revision: 7,
      sync_device_id: deviceId,
    }));
    expect(calls[0].value).not.toHaveProperty('state');
  });

  it.each(['upsert', 'delete'] as const)(
    'rejects a stale %s and leaves the outbox entry available for retry or resolution',
    async (action) => {
      const { client, calls } = clientFor({
        existing: {
          sync_revision: 9,
          updated_by: 'another-device',
          sync_device_id: 'another-device',
        },
      });
      const entry: SyncOutboxEntry = {
        id: `entry-${action}`,
        ownerId,
        revision: 7,
        updatedAt: '2026-09-20T20:00:00.000Z',
        operations: [{
          id: `${action}:local-class`,
          entity: 'class',
          action,
          recordId: 'local-class',
          ...(action === 'upsert'
            ? { payload: { id: 'local-class', name: 'Class', level: '1AS_SCIENCE', stream: '' } }
            : {}),
        }],
        createdAt: '2026-09-20T20:00:00.000Z',
      };
      await enqueueSyncState(ownerId, getEmptyState(), 1, '2026-09-20T19:00:00.000Z');
      await expect(applySyncOutboxEntry(client as never, ownerId, entry, deviceId))
        .rejects.toBeInstanceOf(SyncConflictError);
      expect(calls.some((call) => call.table === 'sync_conflicts')).toBe(true);
      const pending = await listSyncOutbox(ownerId);
      expect(pending.some((item) => item.revision === 1)).toBe(true);
    },
  );

  it('propagates write failures instead of reporting success', async () => {
    const { client } = clientFor({ operationError: new Error('network failure') });
    const entry: SyncOutboxEntry = {
      id: 'entry-failed',
      ownerId,
      revision: 1,
      updatedAt: '2026-09-20T20:00:00.000Z',
      operations: [{
        id: 'class:local-class',
        entity: 'class',
        action: 'upsert',
        recordId: 'local-class',
        payload: { id: 'local-class', name: 'Class', level: '1AS_SCIENCE', stream: '' },
      }],
      createdAt: '2026-09-20T20:00:00.000Z',
    };

    await enqueueSyncOperations(ownerId, entry.operations, entry.revision, entry.updatedAt);
    await expect(applySyncOutboxEntry(client as never, ownerId, entry, deviceId))
      .rejects.toThrow('network failure');
    expect((await listSyncOutbox(ownerId)).some((item) => item.revision === entry.revision)).toBe(true);
  });

  it('records conflicts with a cloud UUID even when the local id is not a UUID', async () => {
    const { client, calls } = clientFor({
      existing: {
        sync_revision: 9,
        updated_by: 'another-device',
        sync_device_id: 'another-device',
      },
    });
    const entry: SyncOutboxEntry = {
      id: 'entry-local-conflict',
      ownerId,
      revision: 7,
      updatedAt: '2026-09-20T20:00:00.000Z',
      operations: [{
        id: 'class:local-class',
        entity: 'class',
        action: 'upsert',
        recordId: 'local-class',
        payload: { id: 'local-class', name: 'Class', level: '1AS_SCIENCE', stream: '' },
      }],
      createdAt: '2026-09-20T20:00:00.000Z',
    };

    await expect(applySyncOutboxEntry(client as never, ownerId, entry, deviceId))
      .rejects.toBeInstanceOf(SyncConflictError);
    const conflict = calls.find((call) => call.table === 'sync_conflicts');
    expect(conflict?.value).toEqual(expect.objectContaining({
      entity_id: getCloudRecordId(ownerId, 'class', 'local-class'),
    }));
  });
});
