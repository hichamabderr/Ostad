'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { getEmptyState, isDemoState } from '@/lib/storage';
import { loadAppStateCache, saveAppStateCache } from '@/lib/state-cache';
import { clearTeacherBinaryFiles } from '@/lib/binary-storage';
import { clearDashboardTasks } from '@/lib/dashboard-tasks';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { applySyncOutboxEntry, clearCloudRosterData, loadCoreState, resetCloudWorkspace, SyncConflictError } from '@/lib/supabase/core-sync';
import { flushMemorandaOutbox } from '@/lib/supabase/memoranda-storage';
import {
  enqueueSyncDelta,
  enqueueSyncState,
  getSyncDeviceId,
  listSyncOutbox,
  removeSyncOutboxEntry,
  clearSyncOutbox,
  markSyncOutboxFailure,
  enqueueSyncOperations,
  type SyncConflictDescriptor,
} from '@/lib/sync-outbox';
import { clearMemorandaOutbox } from '@/lib/supabase/memoranda-outbox';
import { flushAvatarOutbox } from '@/lib/supabase/avatar-storage';
import { clearAvatarOutbox } from '@/lib/supabase/avatar-outbox';
import type { AppState } from '@/lib/storage';

export type CloudSyncStatus =
  | 'loading'
  | 'ready'
  | 'sync-pending'
  | 'sync-failed'
  | 'conflict'
  | 'local-only';

function describeCloudError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object') {
    const candidate = error as { message?: string; details?: string; hint?: string; code?: string; status?: number };
    const parts = [candidate.message, candidate.details, candidate.hint, candidate.code && `code=${candidate.code}`, candidate.status && `status=${candidate.status}`]
      .filter(Boolean)
      .join(' | ');
    if (parts) return new Error(parts);
  }

  return new Error('تعذر الوصول إلى البيانات السحابية. يرجى التحقق من توفر الخدمة والاتصال.');
}

function getStateRecord(state: AppState, entity: SyncConflictDescriptor['entity'], recordId: string): unknown {
  const collections: Record<string, unknown[] | undefined> = {
    class: state.classes, student: state.students, grade: state.grades, session: state.sessions,
    timetable: state.timetable, lessonProgress: state.lessonProgress, customUnit: state.customUnits,
    lessonPlan: state.lessonPlans, dashboardTask: state.dashboardTasks,
  };
  return collections[entity]?.find((record) => (record as { id?: string }).id === recordId);
}

function isLocalOnlyCloudError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string };
  const text = [candidate.message, candidate.details, candidate.hint]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toLowerCase();

  return candidate.code === 'LOCAL_ONLY_CLOUD' || /schema is unavailable|remaining in local-only mode|could not find the table|schema cache/i.test(text);
}

export function getDeletedRecordIds(previous: AppState, next: AppState): string[] {
  const deletedClassIds = new Set(
    previous.classes
      .filter((c) => !next.classes.some((nc) => nc.id === c.id))
      .map((c) => c.id),
  );

  const collections = [
    ['class', previous.classes, next.classes],
    ['student', previous.students, next.students],
    ['grade', previous.grades, next.grades],
    ['session', previous.sessions, next.sessions],
    ['timetable', previous.timetable, next.timetable],
    ['lessonProgress', previous.lessonProgress, next.lessonProgress],
    ['customUnit', previous.customUnits, next.customUnits],
    ['lessonPlan', previous.lessonPlans, next.lessonPlans],
  ] as const;
  const deleted = collections.flatMap(([entity, previousRecords, nextRecords]) => {
    const nextIds = new Set(nextRecords.map((record) => record.id));
    return previousRecords
      .filter((record) => {
        if (nextIds.has(record.id)) return false;
        if (deletedClassIds.size > 0 && 'classId' in record && typeof (record as any).classId === 'string') {
          if (deletedClassIds.has((record as any).classId)) return false;
        }
        return true;
      })
      .map((record) => `${entity}:${record.id}`);
  });
  for (const session of previous.sessions) {
    if (deletedClassIds.has(session.classId)) continue;
    if (!next.sessions.some((item) => item.id === session.id)) continue;
    const nextSession = next.sessions.find((item) => item.id === session.id);
    if (!nextSession) continue;
    for (const studentId of Object.keys(session.attendance || {})) {
      if (!(studentId in (nextSession.attendance || {}))) deleted.push(`attendance:${session.id}:${studentId}`);
    }
    const behaviorLists = [
      ['disruptions', session.disruptions || [], nextSession.disruptions || []],
      ['unwrittenLessons', session.unwrittenLessons || [], nextSession.unwrittenLessons || []],
      ['poorParticipation', session.poorParticipation || [], nextSession.poorParticipation || []],
      ['goodParticipation', session.goodParticipation || [], nextSession.goodParticipation || []],
    ] as const;
    for (const [behavior, previousStudents, nextStudents] of behaviorLists) {
      const nextStudentIds = new Set(nextStudents);
      for (const studentId of previousStudents) {
        if (!nextStudentIds.has(studentId)) deleted.push(`behavior:${session.id}:${studentId}:${behavior}`);
      }
    }
  }
  const nextTaskIds = new Set((next.dashboardTasks || []).map((task) => task.id));
  for (const task of previous.dashboardTasks || []) {
    if (!nextTaskIds.has(task.id)) deleted.push(`dashboardTask:${task.id}`);
  }
  return Array.from(new Set(deleted));
}

export function isAuthenticatedOwner(authenticatedUserId: string | undefined, ownerId: string): boolean {
  return authenticatedUserId === ownerId;
}

async function hasAuthenticatedOwner(
  client: ReturnType<typeof createSupabaseBrowserClient>,
  ownerId: string,
): Promise<boolean> {
  if (!client) return false;
  const { data, error } = await client.auth.getUser();
  return !error && isAuthenticatedOwner(data.user?.id, ownerId);
}

export async function flushSyncOutbox(
  client: ReturnType<typeof createSupabaseBrowserClient>,
  ownerId: string,
  syncingRef: { current: boolean },
  onError: (error: unknown) => void,
): Promise<boolean> {
  if (!client || syncingRef.current) return false;
  if (!(await hasAuthenticatedOwner(client, ownerId))) return false;

  syncingRef.current = true;
  let completed = false;
  let retryAt: number | null = null;
  try {
    await flushAvatarOutbox(ownerId);
    await flushMemorandaOutbox();
    while (true) {
      const entries = await listSyncOutbox(ownerId);
      const entry = entries[0];
      if (!entry) {
        completed = true;
        return true;
      }
      const waitUntil = Date.parse(entry.nextAttemptAt || '');
      if (Number.isFinite(waitUntil) && waitUntil > Date.now()) {
        retryAt = waitUntil;
        return false;
      }
      try {
        await applySyncOutboxEntry(client, ownerId, entry, getSyncDeviceId());
        await removeSyncOutboxEntry(entry.id);
      } catch (error) {
        await markSyncOutboxFailure(entry.id, error);
        throw error;
      }
    }
  } catch (error) {
    onError(error);
    return false;
  } finally {
    syncingRef.current = false;
    if (completed) {
      void listSyncOutbox(ownerId)
        .then((entries) => {
          if (entries.length > 0 && client && !syncingRef.current) {
            void flushSyncOutbox(client, ownerId, syncingRef, onError);
          }
        })
        .catch(onError);
    } else if (retryAt !== null) {
      window.setTimeout(() => {
        if (!syncingRef.current) {
          void flushSyncOutbox(client, ownerId, syncingRef, onError);
        }
      }, Math.max(0, retryAt - Date.now()));
    }
  }
}

let sharedAppState: AppState | null = null;
let sharedCloudStatus: CloudSyncStatus = 'ready';
let sharedLastSyncedState: AppState | null = null;
let sharedRevision = 0;

export function useCloudAppState(user: User | null) {
  const [state, setState] = useState<AppState>(() => sharedAppState || getEmptyState());
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>(() =>
    user ? (sharedAppState ? sharedCloudStatus : 'loading') : 'ready'
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflictDescriptor[]>([]);
  const cloudStatusRef = useRef<CloudSyncStatus>(cloudStatus);
  const [localStorageError, setLocalStorageError] = useState<string | null>(null);
  const cloudReady = !user || cloudStatus !== 'loading';
  const syncingRef = useRef(false);
  const pendingSaveTimerRef = useRef<number | null>(null);
  const saveGenerationRef = useRef(0);
  const latestStateRef = useRef(state);
  const lastSyncedStateRef = useRef<AppState | null>(sharedLastSyncedState);
  const revisionRef = useRef(sharedRevision);
  const updatedAtRef = useRef(new Date(0).toISOString());

  const registerConflict = async (error: unknown): Promise<void> => {
    if (!(error instanceof SyncConflictError) || !user) return;
    const entry = (await listSyncOutbox(user.id)).find((item) =>
      item.operations.some((operation) =>
        operation.entity === error.entity && operation.recordId === error.recordId,
      ),
    );
    const operation = entry?.operations.find((item) =>
      item.entity === error.entity && item.recordId === error.recordId,
    );
    if (!entry || !operation) return;
    const client = createSupabaseBrowserClient();
    if (!client) return;
    let remoteState: AppState;
    try {
      remoteState = await loadCoreState(client, latestStateRef.current);
    } catch (remoteError) {
      setSyncError(describeCloudError(remoteError).message);
      return;
    }
    setConflicts((current) => [{
      entity: error.entity,
      recordId: error.recordId,
      outboxId: entry.id,
      operationId: operation.id,
      localRevision: error.localRevision,
      remoteRevision: error.remoteRevision,
      localPayload: operation.payload,
      remotePayload: getStateRecord(remoteState, error.entity, error.recordId),
    }, ...current.filter((item) => item.outboxId !== entry.id)]);
  };

  useEffect(() => {
    sharedCloudStatus = cloudStatus;
    cloudStatusRef.current = cloudStatus;
  }, [cloudStatus]);

  useEffect(() => {
    sharedAppState = state;
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    let active = true;
    void loadAppStateCache()
      .then((cachedState) => {
        if (!active || !cachedState) return;
        setState((current) => {
          if (!isDemoState(current) && (current.classes.length > 0 || current.students.length > 0)) {
            return current;
          }
          if (!isDemoState(cachedState) && (cachedState.classes.length > 0 || cachedState.students.length > 0)) {
            sharedAppState = cachedState;
            latestStateRef.current = cachedState;
            return cachedState;
          }
          return current;
        });
      })
      .catch((error) => {
        setLocalStorageError(error instanceof Error ? error.message : 'تعذر تحميل النسخة المحلية.');
        console.error('Local workspace load failed:', error);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    if (state.classes.length === 0 && state.students.length === 0 && sharedAppState && (sharedAppState.classes.length > 0 || sharedAppState.students.length > 0)) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveAppStateCache(state).catch((error) => {
        setLocalStorageError(error instanceof Error ? error.message : 'تعذر حفظ النسخة المحلية.');
        console.error('Local state save failed:', error);
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [isMounted, state, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const client = createSupabaseBrowserClient();
    if (!client) {
      window.setTimeout(() => setCloudStatus('local-only'), 0);
      return;
    }

    let active = true;
    const { data: authListener } = client.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return;
      active = false;
      saveGenerationRef.current += 1;
      if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
        window.clearTimeout(pendingSaveTimerRef.current);
        pendingSaveTimerRef.current = null;
      }
      sharedAppState = null;
      sharedCloudStatus = 'ready';
      sharedLastSyncedState = null;
      sharedRevision = 0;
      setCloudStatus('ready');
      setSyncError(null);
      setConflicts([]);
    });
    window.setTimeout(() => {
      if (active && !sharedAppState) setCloudStatus('loading');
    }, 0);
    void loadCoreState(client, latestStateRef.current)
      .then((remoteState) => {
        if (!active) return;
        sharedAppState = remoteState;
        sharedLastSyncedState = remoteState;
        setState(remoteState);
        latestStateRef.current = remoteState;
        lastSyncedStateRef.current = remoteState;
        if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
          revisionRef.current = remoteState.cloudRevision;
          sharedRevision = remoteState.cloudRevision;
        }
        setCloudStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        if (isLocalOnlyCloudError(error)) {
          console.warn('Supabase cloud sync is unavailable. Remaining in local-only mode.');
          setCloudStatus('local-only');
          return;
        }
        console.error('Cloud state load failed:', describeCloudError(error).message);
        setCloudStatus('local-only');
      });

    const refreshRemoteState = async () => {
      if (!active || !(await hasAuthenticatedOwner(client, user.id))) return;
      if (syncingRef.current || pendingSaveTimerRef.current !== null || (await listSyncOutbox(user.id)).length > 0) return;

      const remoteState = await loadCoreState(client, latestStateRef.current);
      sharedAppState = remoteState;
      sharedLastSyncedState = remoteState;
      latestStateRef.current = remoteState;
      lastSyncedStateRef.current = remoteState;
      if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
        revisionRef.current = remoteState.cloudRevision;
        sharedRevision = remoteState.cloudRevision;
      }
      setState(remoteState);
    };

    let channel = client.channel(`core-state:${user.id}`);
    const synchronizedTables = [
      'profiles', 'classes', 'students', 'grades', 'sessions', 'attendance',
      'session_behaviors', 'timetable_slots', 'custom_units', 'lesson_progress',
      'lesson_plans', 'app_settings', 'dashboard_tasks', 'memoranda_files',
    ] as const;
    for (const table of synchronizedTables) {
      channel = channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table,
        ...(table === 'profiles'
          ? { filter: `id=eq.${user.id}` }
          : { filter: `owner_id=eq.${user.id}` }),
      }, (payload) => {
        const newRecord = payload.new as { sync_device_id?: string } | null;
        if (newRecord?.sync_device_id && newRecord.sync_device_id === getSyncDeviceId()) {
          return;
        }
        void refreshRemoteState().catch((error) => {
          if (isLocalOnlyCloudError(error)) {
            setCloudStatus('local-only');
            return;
          }
          console.error(`Realtime ${table} sync failed:`, describeCloudError(error).message);
        });
      });
    }
    channel = channel.subscribe((status) => {
        if (status === 'CHANNEL_ERROR') console.error('Realtime subscription failed');
      });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      void client.removeChannel(channel);
    };
  // The subscription is intentionally scoped to the authenticated user.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!isMounted || !cloudReady) return;
    if (!user) return;
    if (cloudStatus === 'local-only' || cloudStatus === 'conflict') return;
    revisionRef.current += 1;
    sharedRevision = revisionRef.current;
    updatedAtRef.current = new Date().toISOString();
    const revision = revisionRef.current;
    const updatedAt = updatedAtRef.current;
    const saveGeneration = saveGenerationRef.current;
    const timer = window.setTimeout(() => {
      pendingSaveTimerRef.current = -1;
      if (saveGeneration !== saveGenerationRef.current) {
        pendingSaveTimerRef.current = null;
        return;
      }
      const client = createSupabaseBrowserClient();
      const syncedDeletedIds = new Set(state.deletedRecordIds || []);
      void hasAuthenticatedOwner(client, user.id)
        .then((authenticated) => {
          if (!authenticated || saveGeneration !== saveGenerationRef.current) return null;
          return enqueueSyncDelta(user.id, lastSyncedStateRef.current, state, revision, updatedAt);
        })
        .then(async (enqueued) => {
          if (saveGeneration !== saveGenerationRef.current) return false;
          const pending = await listSyncOutbox(user.id);
          if (!enqueued && pending.length === 0) return true;
          return flushSyncOutbox(client, user.id, syncingRef, (error) => {
            if (isLocalOnlyCloudError(error)) {
              setCloudStatus('local-only');
              return;
            }
            const message = describeCloudError(error).message;
            setSyncError(message);
            setCloudStatus(error instanceof Error && error.name === 'SyncConflictError' ? 'conflict' : 'sync-failed');
            void registerConflict(error);
            console.error('Cloud state save failed:', message);
          });
        })
        .then(async (flushed) => {
          if (!flushed || (await listSyncOutbox(user.id)).length > 0) return;
          sharedLastSyncedState = state;
          lastSyncedStateRef.current = state;
          setSyncError(null);
          setCloudStatus('ready');
          setState((previous) => (
            previous.deletedRecordIds?.length
              ? {
                  ...previous,
                  deletedRecordIds: previous.deletedRecordIds.filter(
                    (id) => !syncedDeletedIds.has(id),
                  ),
                }
              : previous
          ));
        })
        .finally(() => {
          if (pendingSaveTimerRef.current === -1) pendingSaveTimerRef.current = null;
        });
    }, 700);
    pendingSaveTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (pendingSaveTimerRef.current === timer) pendingSaveTimerRef.current = null;
    };
  // user is read by the scheduled callback; changing its id also resets cloudReady.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudReady, cloudStatus, isMounted, state, user?.id]);

  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const retryWhenOnline = async () => {
      const client = createSupabaseBrowserClient();
      if (!client || syncingRef.current || pendingSaveTimerRef.current !== null) return;
      setCloudStatus('loading');
      const flushed = await flushSyncOutbox(client, user.id, syncingRef, (error) => {
        console.error('Cloud sync retry failed:', describeCloudError(error).message);
      });
      if (!flushed || (await listSyncOutbox(user.id)).length > 0) {
        setCloudStatus('local-only');
        return;
      }

      try {
        const remoteState = await loadCoreState(client, latestStateRef.current);
        setState(remoteState);
        latestStateRef.current = remoteState;
        lastSyncedStateRef.current = remoteState;
        if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
          revisionRef.current = remoteState.cloudRevision;
        }
        setCloudStatus('ready');
      } catch (error) {
        setCloudStatus('local-only');
        console.error('Cloud sync retry failed:', describeCloudError(error).message);
      }
    };
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
  // The retry listener is intentionally scoped to the authenticated user.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const retrySync = async (): Promise<void> => {
    if (!user || syncingRef.current || cloudStatusRef.current === 'conflict') return;
    const client = createSupabaseBrowserClient();
    if (!client) {
      setCloudStatus('local-only');
      return;
    }
    setCloudStatus('sync-pending');
    setSyncError(null);
    const flushed = await flushSyncOutbox(client, user.id, syncingRef, (error) => {
      const message = describeCloudError(error).message;
      setSyncError(message);
      setCloudStatus(error instanceof Error && error.name === 'SyncConflictError' ? 'conflict' : 'sync-failed');
      void registerConflict(error);
      console.error('Cloud sync retry failed:', message);
    });
    if (!flushed || (await listSyncOutbox(user.id)).length > 0) return;
    try {
      const remoteState = await loadCoreState(client, latestStateRef.current);
      latestStateRef.current = remoteState;
      lastSyncedStateRef.current = remoteState;
      if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
        revisionRef.current = remoteState.cloudRevision;
      }
      setState(remoteState);
      setCloudStatus('ready');
    } catch (error) {
      const message = describeCloudError(error).message;
      setSyncError(message);
      setCloudStatus('sync-failed');
      console.error('Cloud sync retry failed:', message);
    }
  };

  const resolveConflictKeepRemote = async (conflict: SyncConflictDescriptor): Promise<void> => {
    if (!user) throw new Error('لا يمكن حل التعارض دون تسجيل الدخول.');
    const client = createSupabaseBrowserClient();
    if (!client) throw new Error('لا يمكن حل التعارض دون اتصال بالخادم السحابي.');
    await removeSyncOutboxEntry(conflict.outboxId);
    const remoteState = await loadCoreState(client, latestStateRef.current);
    latestStateRef.current = remoteState;
    lastSyncedStateRef.current = remoteState;
    if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
      revisionRef.current = remoteState.cloudRevision;
    }
    setState(remoteState);
    setConflicts((current) => current.filter((item) => item.outboxId !== conflict.outboxId));
    setSyncError(null);
    setCloudStatus('ready');
  };

  const resolveConflictKeepLocal = async (conflict: SyncConflictDescriptor): Promise<void> => {
    if (!user) throw new Error('لا يمكن حل التعارض دون تسجيل الدخول.');
    const client = createSupabaseBrowserClient();
    if (!client) throw new Error('لا يمكن حل التعارض دون اتصال بالخادم السحابي.');
    const entries = await listSyncOutbox(user.id);
    const entry = entries.find((item) => item.id === conflict.outboxId);
    if (!entry) throw new Error('لم تعد عملية التعارض موجودة في طابور المزامنة.');
    const operations = entry.operations.map((operation) => ({
      ...operation,
      id: `${operation.id}:${globalThis.crypto.randomUUID()}`,
    }));
    await removeSyncOutboxEntry(entry.id);
    const remoteRevision = Math.max(conflict.remoteRevision, revisionRef.current);
    revisionRef.current = remoteRevision + 1;
    await enqueueSyncOperations(user.id, operations, revisionRef.current, new Date().toISOString());
    setConflicts((current) => current.filter((item) => item.outboxId !== conflict.outboxId));
    setCloudStatus('sync-pending');
    setSyncError(null);
    const flushed = await flushSyncOutbox(client, user.id, syncingRef, (error) => {
      setSyncError(describeCloudError(error).message);
      setCloudStatus(error instanceof SyncConflictError ? 'conflict' : 'sync-failed');
    });
    if (!flushed || (await listSyncOutbox(user.id)).length > 0) {
      throw new Error('تعذر تأكيد النسخة المحلية بعد حل التعارض.');
    }
    const remoteState = await loadCoreState(client, latestStateRef.current);
    latestStateRef.current = remoteState;
    lastSyncedStateRef.current = remoteState;
    if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
      revisionRef.current = remoteState.cloudRevision;
    }
    setState(remoteState);
    setCloudStatus('ready');
  };

  const handleUpdateState = (updater: (previous: AppState) => AppState) => {
    if (user && (cloudStatus === 'ready' || cloudStatus === 'sync-failed')) {
      setCloudStatus('sync-pending');
      setSyncError(null);
    }
    setState((previous) => {
      const next = updater(previous);
      const deletedRecordIds = getDeletedRecordIds(previous, next);
      if (deletedRecordIds.length > 0) {
        return {
          ...next,
          deletedRecordIds: Array.from(new Set([
            ...(previous.deletedRecordIds || []),
            ...deletedRecordIds,
          ])),
        };
      }
      return {
        ...next,
        deletedRecordIds: previous.deletedRecordIds || [],
      };
    });
  };

  const waitForSyncConfirmation = async (): Promise<void> => {
    if (!user) {
      throw new Error('لا يمكن إعلان نجاح سحابي قبل تسجيل الدخول.');
    }
    const currentStatus = cloudStatusRef.current;
    if (currentStatus === 'conflict') {
      throw new Error('توجد عملية مزامنة متعارضة. أعد المحاولة قبل حفظ تغيير جديد.');
    }

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const deadline = Date.now() + 2_500;
    let observedPendingWork = false;
    while (Date.now() < deadline) {
      const pending = await listSyncOutbox(user.id);
      const status = cloudStatusRef.current;
      if (pending.length > 0 || status === 'sync-pending' || status === 'loading') {
        observedPendingWork = true;
      }
      if (status === 'conflict' || status === 'local-only') {
        throw new Error(syncError || 'تعذر تأكيد الحفظ في السحابة.');
      }
      if (observedPendingWork && status === 'ready' && pending.length === 0) {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    throw new Error('تأخر تأكيد الحفظ السحابي. حُفظ التغيير محلياً وستتم إعادة المزامنة تلقائياً.');
  };

  const updateStateAndWait = async (updater: (previous: AppState) => AppState): Promise<void> => {
    handleUpdateState(updater);
    try {
      await waitForSyncConfirmation();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('تأخر تأكيد الحفظ السحابي')) {
        return;
      }
      throw error;
    }
  };

  const replaceStateFromBackup = async (nextState: AppState): Promise<void> => {
    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }
    if (user) await clearSyncOutbox(user.id);
    const normalizedState = {
      ...nextState,
      deletedRecordIds: Array.from(new Set([
        ...(nextState.deletedRecordIds || []),
        ...getDeletedRecordIds(latestStateRef.current, nextState),
      ])),
      activeClassId: nextState.classes.some((item) => item.id === nextState.activeClassId)
        ? nextState.activeClassId
        : nextState.classes[0]?.id || null,
    };
    setState(normalizedState);
    latestStateRef.current = normalizedState;
    lastSyncedStateRef.current = null;
    await saveAppStateCache(normalizedState);
    setLocalStorageError(null);
    if (user) await waitForSyncConfirmation();
  };

  const clearRosterData = async (): Promise<void> => {
    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }

    if (user) {
      const client = createSupabaseBrowserClient();
      if (!client) throw new Error('لا يمكن مزامنة إعادة التعيين دون اتصال بالخادم السحابي.');

      // Purge outbox so any old pending or failed operations are cleared
      await clearSyncOutbox(user.id);
      setCloudStatus('sync-pending');
      setSyncError(null);

      try {
        await clearCloudRosterData(client, user.id);
        // Purge outbox again to ensure clean slate
        await clearSyncOutbox(user.id);
      } catch (error) {
        setCloudStatus('sync-failed');
        const message = describeCloudError(error).message;
        setSyncError(message);
        throw error;
      }
    }

    const previousState = latestStateRef.current;
    const nextState: AppState = {
      ...previousState,
      classes: [],
      students: [],
      sessions: [],
      grades: [],
      timetable: [],
      lessonProgress: [],
      activeClassId: null,
      deletedRecordIds: [],
    };

    sharedAppState = nextState;
    latestStateRef.current = nextState;
    lastSyncedStateRef.current = nextState;
    setState(nextState);
    await saveAppStateCache(nextState);

    setSyncError(null);
    setCloudStatus(user ? 'ready' : 'local-only');
    setConflicts([]);
  };

  const resetWorkspace = async (): Promise<void> => {
    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }
    if (user) {
      const client = createSupabaseBrowserClient();
      if (!client) throw new Error('لا يمكن تنظيف مساحة الحساب دون اتصال بالخادم السحابي.');
      await resetCloudWorkspace(client, user.id);
      await clearSyncOutbox(user.id);
    }
    await clearMemorandaOutbox();
    await clearAvatarOutbox();
    await clearTeacherBinaryFiles();
    await clearDashboardTasks();
    const emptyState = getEmptyState();
    await saveAppStateCache(emptyState);
    setLocalStorageError(null);
    setState(emptyState);
    latestStateRef.current = emptyState;
    lastSyncedStateRef.current = emptyState;
    revisionRef.current = 0;
  };

  return {
    state,
    handleUpdateState,
    updateStateAndWait,
    replaceStateFromBackup,
    clearRosterData,
    resetWorkspace,
    isMounted,
    cloudReady,
    cloudStatus,
    syncError,
    localStorageError,
    retrySync,
    conflicts,
    resolveConflictKeepRemote,
    resolveConflictKeepLocal,
  };
}
