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
import {
  getSyncOperationsForState,
  getSyncOperationsDelta,
  enqueueSyncDelta,
  recordsShallowEqual,
} from '@/lib/sync-outbox';
import { getDeletedRecordIds, isAuthenticatedOwner } from '@/hooks/useCloudAppState';
import {
  applySyncOutboxEntry,
  getCloudRecordId,
  loadCoreState,
  SyncConflictError,
} from '@/lib/supabase/core-sync';
import { commitRosterImportBatch } from '@/lib/supabase/roster-import';
import {
  enqueueSyncState,
  enqueueSyncOperations,
  listSyncOutbox,
  markSyncOutboxFailure,
  syncRetryDelay,
  type SyncOperation,
  type SyncOutboxEntry,
} from '@/lib/sync-outbox';
import {
  enqueueAvatarDelete,
  enqueueAvatarUpload,
  getAvatarOutboxEntry,
  removeAvatarOutboxEntry,
} from '@/lib/supabase/avatar-outbox';

describe('sync outbox', () => {
  it('rejects a stale owner after logout before starting a cloud write', () => {
    expect(isAuthenticatedOwner('owner-1', 'owner-1')).toBe(true);
    expect(isAuthenticatedOwner(undefined, 'owner-1')).toBe(false);
    expect(isAuthenticatedOwner('owner-2', 'owner-1')).toBe(false);
  });

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

  it('uses capped exponential backoff and preserves failed outbox entries', async () => {
    expect(syncRetryDelay(1)).toBe(2000);
    expect(syncRetryDelay(8)).toBe(256000);
    expect(syncRetryDelay(20)).toBe(256000);

    const id = await enqueueSyncOperations('owner-1', [], 4, '2026-09-20T20:00:00.000Z');
    await markSyncOutboxFailure(id, new Error('temporary failure'));
    const [entry] = await listSyncOutbox('owner-1');
    expect(entry.attempts).toBe(1);
    expect(entry.lastError).toBe('temporary failure');
    expect(Date.parse(entry.nextAttemptAt || '')).toBeGreaterThan(Date.now());
  });

  it('keeps avatar uploads and deletes as explicit offline operations', async () => {
    await enqueueAvatarUpload(new File(['avatar'], 'avatar.png', { type: 'image/png' }));
    expect((await getAvatarOutboxEntry())?.action).toBe('upload');
    await enqueueAvatarDelete();
    expect((await getAvatarOutboxEntry())?.action).toBe('delete');
    await removeAvatarOutboxEntry();
    expect(await getAvatarOutboxEntry()).toBeUndefined();
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
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
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

  it('normalizes student birth date to ISO YYYY-MM-DD when applying outbox upsert', async () => {
    const { client, calls } = clientFor();
    const operation: SyncOperation = {
      id: 'student:s-algeria',
      entity: 'student',
      action: 'upsert',
      recordId: 's-algeria',
      payload: {
        id: 's-algeria',
        classId: 'c1',
        fullName: 'أحمد بن علي',
        numberInList: 1,
        birthDate: '15/06/2008', // Algerian school format
        gender: 'M',
      },
    };
    const entry: SyncOutboxEntry = {
      id: 'entry-date-test',
      ownerId,
      revision: 1,
      updatedAt: '2026-09-22T08:00:00.000Z',
      operations: [operation],
      createdAt: '2026-09-22T08:00:00.000Z',
    };

    await applySyncOutboxEntry(client as never, ownerId, entry, deviceId);

    const studentCall = calls.find((c) => c.table === 'students');
    expect(studentCall).toBeDefined();
    expect(studentCall?.method).toBe('upsert');
    expect(studentCall?.value).toEqual(expect.objectContaining({
      birth_date: '2008-06-15',
      gender: 'male',
      full_name: 'أحمد بن علي',
    }));
  });

  it('loadCoreState preserves local un-synced classes and students when remote is empty', async () => {
    const { client } = clientFor();
    const localState = getEmptyState();
    localState.classes = [
      { id: 'c1', name: '2 لغات 1', level: '2AS_L', stream: 'لغات' },
    ];
    localState.students = [
      { id: 's1', classId: 'c1', fullName: 'تلميذ تجريبي', numberInList: 1 },
    ];

    const loaded = await loadCoreState(client as never, localState);
    expect(loaded.classes).toHaveLength(1);
    expect(loaded.classes[0].name).toBe('2 لغات 1');
    expect(loaded.students).toHaveLength(1);
    expect(loaded.students[0].fullName).toBe('تلميذ تجريبي');
  });

  it('loadCoreState respects deletedRecordIds and does not retain deleted classes or students', async () => {
    const { client } = clientFor();
    const localState = getEmptyState();
    localState.classes = [
      { id: 'c1', name: '2 لغات 1', level: '2AS_L', stream: 'لغات' },
    ];
    localState.students = [
      { id: 's1', classId: 'c1', fullName: 'تلميذ تجريبي', numberInList: 1 },
    ];
    localState.deletedRecordIds = ['class:c1', 'student:s1'];

    const loaded = await loadCoreState(client as never, localState);
    expect(loaded.classes).toHaveLength(0);
    expect(loaded.students).toHaveLength(0);
  });
});

describe('delta sync engine', () => {
  const ownerId = 'delta-owner';

  it('correctly compares objects using recordsShallowEqual', () => {
    expect(recordsShallowEqual(null, null)).toBe(true);
    expect(recordsShallowEqual({ a: 1, b: 'two' }, { a: 1, b: 'two' })).toBe(true);
    expect(recordsShallowEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true);
    expect(recordsShallowEqual({ a: 1, b: 'two' }, { a: 1, b: 'three' })).toBe(false);
    expect(recordsShallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('returns empty array when previousState and nextState are identical', () => {
    const state = getEmptyState();
    state.classes = [{ id: 'c1', name: '1AS', level: '1AS_SCIENCE', stream: '' }];
    state.students = [{ id: 's1', classId: 'c1', firstName: 'أحمد', lastName: 'محمد' }];
    state.grades = [{ id: 'g1', studentId: 's1', classId: 'c1', trimester: 1, continuousAssessment: 15 }];

    const ops = getSyncOperationsDelta(state, state);
    expect(ops).toHaveLength(0);
  });

  it('produces only one operation when a single grade changes', () => {
    const prevState = getEmptyState();
    prevState.classes = [{ id: 'c1', name: '1AS', level: '1AS_SCIENCE', stream: '' }];
    prevState.students = [
      { id: 's1', classId: 'c1', firstName: 'أحمد', lastName: 'محمد' },
      { id: 's2', classId: 'c1', firstName: 'علي', lastName: 'فاطمة' },
    ];
    prevState.grades = [
      { id: 'g1', studentId: 's1', classId: 'c1', trimester: 1, continuousAssessment: 15 },
      { id: 'g2', studentId: 's2', classId: 'c1', trimester: 1, continuousAssessment: 14 },
    ];

    const nextState = {
      ...prevState,
      grades: [
        { ...prevState.grades[0], continuousAssessment: 18 },
        prevState.grades[1],
      ],
    };

    const ops = getSyncOperationsDelta(prevState, nextState);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual(expect.objectContaining({
      id: 'grade:g1',
      entity: 'grade',
      action: 'upsert',
      recordId: 'g1',
      payload: expect.objectContaining({ continuousAssessment: 18 }),
    }));
  });

  it('produces a delete operation when an entity is removed in nextState', () => {
    const prevState = getEmptyState();
    prevState.students = [
      { id: 's1', classId: 'c1', firstName: 'أحمد', lastName: 'محمد' },
      { id: 's2', classId: 'c1', firstName: 'علي', lastName: 'فاطمة' },
    ];

    const nextState = {
      ...prevState,
      students: [prevState.students[0]], // s2 removed
    };

    const ops = getSyncOperationsDelta(prevState, nextState);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      id: 'delete:student:s2',
      entity: 'student',
      action: 'delete',
      recordId: 's2',
    });
  });

  it('produces delete operations for attendance and behaviors when removed from a session', () => {
    const prevState = getEmptyState();
    prevState.sessions = [{
      id: 'sess-1',
      classId: 'c1',
      date: '2026-09-21',
      attendance: { s1: 'absent', s2: 'late' },
      disruptions: ['s1'],
      unwrittenLessons: [],
      poorParticipation: [],
      goodParticipation: [],
    }];

    const nextState = {
      ...prevState,
      sessions: [{
        ...prevState.sessions[0],
        attendance: { s1: 'absent' }, // s2 attendance removed
        disruptions: [], // s1 disruption removed
      }],
    };

    const ops = getSyncOperationsDelta(prevState, nextState);
    const deleteAttendance = ops.find((o) => o.id === 'delete:attendance:sess-1:s2');
    const deleteBehavior = ops.find((o) => o.id === 'delete:behavior:sess-1:s1:disruptions');
    expect(deleteAttendance).toBeDefined();
    expect(deleteBehavior).toBeDefined();
  });

  it('enqueueSyncDelta returns null when no delta exists', async () => {
    const state = getEmptyState();
    const result = await enqueueSyncDelta(ownerId, state, state, 1, new Date().toISOString());
    expect(result).toBeNull();
  });
});
