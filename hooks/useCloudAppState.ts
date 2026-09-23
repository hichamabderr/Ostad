'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { getEmptyState, isDemoState } from '@/lib/storage';
import { loadAppStateCache, saveAppStateCache } from '@/lib/state-cache';
import { clearTeacherBinaryFiles } from '@/lib/binary-storage';
import { clearDashboardTasks } from '@/lib/dashboard-tasks';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { applySyncOutboxEntry, clearCloudRosterData, loadCoreState, resetCloudWorkspace, SyncConflictError } from '@/lib/supabase/core-sync';
import { commitRosterImportBatch, type RosterImportClass, type RosterImportStudent } from '@/lib/supabase/roster-import';
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
  const allowEmptyRosterRef = useRef(false);

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

  // Unified initial state initialization: loads IndexedDB cache first, then syncs with Supabase if online
  useEffect(() => {
    let active = true;

    const initializeState = async () => {
      // 1. Ensure local cache is checked first if in-memory sharedAppState is absent or empty
      let currentLocal = sharedAppState;
      if (!currentLocal || (currentLocal.classes.length === 0 && currentLocal.students.length === 0)) {
        try {
          const cachedState = await loadAppStateCache();
          if (cachedState && !isDemoState(cachedState) && (cachedState.classes.length > 0 || cachedState.students.length > 0)) {
            currentLocal = cachedState;
            if (active) {
              sharedAppState = cachedState;
              latestStateRef.current = cachedState;
              setState(cachedState);
            }
          }
        } catch (cacheErr) {
          console.error('Local workspace load failed:', cacheErr);
          if (active) setLocalStorageError(cacheErr instanceof Error ? cacheErr.message : 'تعذر تحميل النسخة المحلية.');
        }
      }

      // 2. If not authenticated, local workspace is ready
      if (!user) {
        if (active) setCloudStatus('ready');
        return;
      }

      // 3. Authenticated: load from Supabase
      const client = createSupabaseBrowserClient();
      if (!client) {
        if (active) setCloudStatus('local-only');
        return;
      }

      if (active && (!currentLocal || currentLocal.classes.length === 0)) {
        setCloudStatus('loading');
      }

      try {
        const remoteState = await loadCoreState(client, currentLocal || latestStateRef.current);
        if (!active) return;

        const remoteHasRoster = remoteState.classes.length > 0;
        const localHasRoster = Boolean(currentLocal && currentLocal.classes.length > 0);

        if (remoteHasRoster) {
          // Supabase has authoritative data
          sharedAppState = remoteState;
          sharedLastSyncedState = remoteState;
          latestStateRef.current = remoteState;
          lastSyncedStateRef.current = remoteState;
          setState(remoteState);
          void saveAppStateCache(remoteState);
        } else if (localHasRoster && currentLocal) {
          // Safeguard: Remote is empty but local has roster! NEVER wipe the user's roster.
          console.warn('Remote has 0 classes but local cache has classes. Preserving local roster.');
          sharedAppState = currentLocal;
          latestStateRef.current = currentLocal;
          setState(currentLocal);
        } else {
          // Clean empty state for new user
          sharedAppState = remoteState;
          sharedLastSyncedState = remoteState;
          latestStateRef.current = remoteState;
          lastSyncedStateRef.current = remoteState;
          setState(remoteState);
        }

        if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
          revisionRef.current = remoteState.cloudRevision;
          sharedRevision = remoteState.cloudRevision;
        }

        setCloudStatus('ready');

        // Flush any pending outbox entries
        const pending = await listSyncOutbox(user.id);
        if (pending.length > 0 && active) {
          void flushSyncOutbox(client, user.id, syncingRef, (err) => {
            console.error('Initial outbox flush failed:', err);
          });
        }
      } catch (error) {
        if (!active) return;
        if (isLocalOnlyCloudError(error)) {
          console.warn('Supabase cloud sync is unavailable. Remaining in local-only mode.');
          setCloudStatus('local-only');
          return;
        }
        console.error('Cloud state load failed:', describeCloudError(error).message);
        setCloudStatus('local-only');
      }
    };

    void initializeState();

    return () => {
      active = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Protected cache save effect
  useEffect(() => {
    if (!isMounted) return;
    if (!allowEmptyRosterRef.current && state.classes.length === 0 && state.students.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      void saveAppStateCache(state, { allowEmptyRoster: allowEmptyRosterRef.current })
        .then(() => {
          setLocalStorageError(null);
        })
        .catch((error) => {
          setLocalStorageError(error instanceof Error ? error.message : 'تعذر حفظ النسخة المحلية.');
          console.error('Local state save failed:', error);
        });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [isMounted, state, user]);

  // Supabase Auth listener & Realtime change subscriptions
  useEffect(() => {
    if (!user) {
      return;
    }

    const client = createSupabaseBrowserClient();
    if (!client) {
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

    const refreshRemoteState = async () => {
      if (!active || !(await hasAuthenticatedOwner(client, user.id))) return;
      if (syncingRef.current || pendingSaveTimerRef.current !== null || (await listSyncOutbox(user.id)).length > 0) return;

      const remoteState = await loadCoreState(client, latestStateRef.current);
      if (remoteState.classes.length > 0 || latestStateRef.current.classes.length === 0) {
        sharedAppState = remoteState;
        sharedLastSyncedState = remoteState;
        latestStateRef.current = remoteState;
        lastSyncedStateRef.current = remoteState;
        if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
          revisionRef.current = remoteState.cloudRevision;
          sharedRevision = remoteState.cloudRevision;
        }
        setState(remoteState);
      }
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
    allowEmptyRosterRef.current = true;
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
    await saveAppStateCache(nextState, { allowEmptyRoster: true });

    setSyncError(null);
    setCloudStatus(user ? 'ready' : 'local-only');
    setConflicts([]);
  };

  const resetWorkspace = async (): Promise<void> => {
    allowEmptyRosterRef.current = true;
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
    await saveAppStateCache(emptyState, { allowEmptyRoster: true });
    setLocalStorageError(null);
    setState(emptyState);
    latestStateRef.current = emptyState;
    lastSyncedStateRef.current = emptyState;
    revisionRef.current = 0;
  };

  const commitRosterImport = async (
    importedClasses: RosterImportClass[],
    importedStudents: RosterImportStudent[],
    nextState: AppState,
  ): Promise<void> => {
    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }

    // Immediately update in-memory state and persist to local cache
    sharedAppState = nextState;
    latestStateRef.current = nextState;
    setState(nextState);
    await saveAppStateCache(nextState);
    setLocalStorageError(null);

    if (!user) {
      return;
    }

    setCloudStatus('sync-pending');
    setSyncError(null);

    try {
      const client = createSupabaseBrowserClient();
      if (!client) throw new Error('تعذر الوصول إلى الخادم السحابي لتأكيد الاستيراد.');

      // 1. Direct atomic bulk upsert to Supabase classes and students tables
      const committed = await commitRosterImportBatch(importedClasses, importedStudents);

      // Reconcile local state with any cloud IDs reconciled by the server
      let reconciledState = nextState;
      if (committed.classes.length > 0 || committed.students.length > 0) {
        const classMap = new Map(committed.classes.map(c => [c.name, c.id]));
        const studentMap = new Map(committed.students.map(s => [`${s.classId}:${s.numberInList}`, s.id]));

        const updatedClasses = nextState.classes.map(c => {
          const cloudId = classMap.get(c.name);
          return cloudId && cloudId !== c.id ? { ...c, id: cloudId } : c;
        });

        const updatedStudents = nextState.students.map(s => {
          const targetClass = updatedClasses.find(c => c.name === nextState.classes.find(oc => oc.id === s.classId)?.name) || { id: s.classId };
          const cloudId = studentMap.get(`${targetClass.id}:${s.numberInList}`);
          return {
            ...s,
            classId: targetClass.id,
            id: cloudId || s.id,
          };
        });

        reconciledState = {
          ...nextState,
          classes: updatedClasses,
          students: updatedStudents,
        };
        sharedAppState = reconciledState;
        latestStateRef.current = reconciledState;
        setState(reconciledState);
        await saveAppStateCache(reconciledState);
      }

      // 2. Profile updates if school name, academic year, or state changed
      if (nextState.profile && (nextState.profile.schoolName || nextState.profile.academicYear || nextState.profile.stateName)) {
        await (client as any).from('profiles').update({
          school_name: nextState.profile.schoolName || null,
          academic_year: nextState.profile.academicYear || null,
          wilaya: nextState.profile.stateName || null,
          updated_at: new Date().toISOString(),
        }).eq('id', user.id);
      }

      // 3. Clear any pending class/student delta operations from outbox for this user to avoid redundant mutations
      const pendingEntries = await listSyncOutbox(user.id);
      for (const entry of pendingEntries) {
        const hasRosterOp = entry.operations.some((op) => op.entity === 'class' || op.entity === 'student');
        if (hasRosterOp) {
          const nonRosterOps = entry.operations.filter((op) => op.entity !== 'class' && op.entity !== 'student');
          if (nonRosterOps.length === 0) {
            await removeSyncOutboxEntry(entry.id);
          }
        }
      }

      sharedLastSyncedState = reconciledState;
      lastSyncedStateRef.current = reconciledState;
      setCloudStatus('ready');
      setSyncError(null);
    } catch (error) {
      const message = describeCloudError(error).message;
      console.error('commitRosterImport failed:', message);
      setSyncError(message);
      setCloudStatus('sync-failed');
      throw error;
    }
  };

  return {
    state,
    handleUpdateState,
    updateStateAndWait,
    replaceStateFromBackup,
    commitRosterImport,
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
