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
  SYNCHRONIZED_TABLES,
  isSelfAuthoredChange,
  nextRevisionFloor,
  shouldApplyRemoteRefresh,
  shouldFlushOnBackground,
} from '@/lib/realtime-guard';
import {
  enqueueSyncDelta,
  getSyncDeviceId,
  listSyncOutbox,
  removeSyncOutboxEntry,
  clearSyncOutbox,
  markSyncOutboxFailure,
  enqueueSyncOperations,
  listPendingRecordIds,
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
  force = false,
): Promise<boolean> {
  if (!client || syncingRef.current) return false;
  if (!(await hasAuthenticatedOwner(client, ownerId))) return false;

  syncingRef.current = true;
  let completed = false;
  let retryAt: number | null = null;
  try {
    await flushAvatarOutbox(ownerId);
    await flushMemorandaOutbox(ownerId);
    while (true) {
      const entries = await listSyncOutbox(ownerId);
      const entry = entries[0];
      if (!entry) {
        completed = true;
        return true;
      }
      const waitUntil = Date.parse(entry.nextAttemptAt || '');
      if (!force && Number.isFinite(waitUntil) && waitUntil > Date.now()) {
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

export function useCloudAppState(user: User | null) {
  const [state, setState] = useState<AppState>(getEmptyState);
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>(() =>
    user ? 'loading' : 'ready'
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
  const lastSyncedStateRef = useRef<AppState | null>(null);
  const revisionRef = useRef(0);
  const updatedAtRef = useRef(new Date(0).toISOString());
  // Incremented synchronously on every user edit. A Realtime refresh captures it before its
  // fetch and refuses to apply a response if it moved meanwhile (the clobber race).
  const localEditSeqRef = useRef(0);

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
    cloudStatusRef.current = cloudStatus;
  }, [cloudStatus]);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  // Unified initial state initialization: loads user-scoped IndexedDB cache first, then syncs with Supabase
  useEffect(() => {
    let active = true;

    const initializeState = async () => {
      // 1. Load user-scoped local cache first
      let currentLocal: AppState | null = null;
      try {
        const cachedState = await loadAppStateCache(user?.id);
        if (cachedState && !isDemoState(cachedState)) {
          currentLocal = cachedState;
          // Start the revision clock where the last successful sync left it. Without this an
          // offline start would publish revision 1 writes and silently overwrite rows that
          // changed on the server meanwhile (SYNC-REVIEW.md 3.7).
          revisionRef.current = nextRevisionFloor(revisionRef.current, cachedState.cloudRevision);
          if (active) {
            latestStateRef.current = cachedState;
            setState(cachedState);
          }
        }
      } catch (cacheErr) {
        console.error('Local workspace load failed:', cacheErr);
        if (active) setLocalStorageError(cacheErr instanceof Error ? cacheErr.message : 'تعذر تحميل النسخة المحلية.');
      }

      // 2. If not authenticated, local workspace is ready
      if (!user) {
        if (active) setCloudStatus('ready');
        return;
      }

      // 3. Authenticated: load authoritative state from Supabase
      const client = createSupabaseBrowserClient();
      if (!client) {
        if (active) setCloudStatus('local-only');
        return;
      }

      if (active && (!currentLocal || currentLocal.classes.length === 0)) {
        setCloudStatus('loading');
      }

      try {
        // Read the outbox *before* loading so genuinely unsynced local work survives
        // the authoritative merge, while stale cache entries are dropped.
        let pendingRecordIds = await listPendingRecordIds(user.id);

        let remoteState = await loadCoreState(client, currentLocal || latestStateRef.current, { pendingRecordIds });
        if (!active) return;

        // Flush any pending outbox entries for this user
        if (pendingRecordIds.size > 0) {
          await flushSyncOutbox(client, user.id, syncingRef, (err) => {
            console.warn('Initial pending outbox flush warning:', err);
          }, true);
          if (!active) return;
          // Recompute instead of assuming the flush drained everything: a partially
          // failed flush must keep its local records, or the refresh would hide them.
          pendingRecordIds = await listPendingRecordIds(user.id);
          if (pendingRecordIds.size === 0) {
            // Everything acknowledged: the cloud is now the only truth for this load.
            const refreshed = await loadCoreState(client, remoteState, { pendingRecordIds });
            remoteState = refreshed;
          }
        }

        latestStateRef.current = remoteState;
        lastSyncedStateRef.current = remoteState;

        if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
          revisionRef.current = remoteState.cloudRevision;
        }

        setState(remoteState);
        void saveAppStateCache(remoteState, user.id);
        setCloudStatus('ready');
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

  // Cache save effect (user-scoped)
  useEffect(() => {
    if (!isMounted) return;
    if (isDemoState(state)) return;
    const timer = window.setTimeout(() => {
      void saveAppStateCache(state, user?.id)
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
      revisionRef.current = 0;
      lastSyncedStateRef.current = null;
      setCloudStatus('ready');
      setSyncError(null);
      setConflicts([]);
    });

    /** Whether the fetched state may still replace the local one (see realtime-guard). */
    const refreshAllowed = async (expectedGeneration: number, expectedEditSeq: number) => shouldApplyRemoteRefresh({
      active,
      authenticated: true,
      syncing: syncingRef.current,
      pendingSaveScheduled: pendingSaveTimerRef.current !== null,
      pendingOutboxCount: (await listSyncOutbox(user.id)).length,
      generationChanged: saveGenerationRef.current !== expectedGeneration,
      localEditsDuringFetch: localEditSeqRef.current - expectedEditSeq,
    });

    const refreshRemoteState = async () => {
      const expectedGeneration = saveGenerationRef.current;
      const expectedEditSeq = localEditSeqRef.current;
      if (!active || !(await hasAuthenticatedOwner(client, user.id))) return;
      if (!(await refreshAllowed(expectedGeneration, expectedEditSeq))) return;

      const remoteState = await loadCoreState(client, latestStateRef.current);

      // Re-check after the round trip: the fetch result is stale if the user edited while
      // it was in flight, and applying it would silently roll that edit back on screen.
      if (!(await refreshAllowed(expectedGeneration, expectedEditSeq))) return;

      latestStateRef.current = remoteState;
      lastSyncedStateRef.current = remoteState;
      revisionRef.current = nextRevisionFloor(revisionRef.current, remoteState.cloudRevision);
      setState(remoteState);
      void saveAppStateCache(remoteState, user.id);
    };

    let channel = client.channel(`core-state:${user.id}`);
    for (const table of SYNCHRONIZED_TABLES) {
      channel = channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table,
        ...(table === 'profiles'
          ? { filter: `id=eq.${user.id}` }
          : { filter: `owner_id=eq.${user.id}` }),
      }, (payload) => {
        // Our own writes echo back on this channel. Refreshing for them is wasted work, and
        // the fetch would race the in-memory state the user has already moved past.
        if (isSelfAuthoredChange(payload, getSyncDeviceId())) return;
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

  // Debounced background save effect for standard changes
  useEffect(() => {
    if (!isMounted || !cloudReady) return;
    if (!user) return;
    // An unresolved conflict must be answered by the user before more work is queued.
    // `local-only` no longer blocks queueing: offline edits are persisted to the outbox
    // and retried automatically instead of living only in memory.
    if (cloudStatus === 'conflict') return;
    // Guard: do NOT trigger save if state is identical to last synced state
    if (state === lastSyncedStateRef.current) return;

    revisionRef.current += 1;
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
    }, 300);
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
      }, true);
      if (!flushed || (await listSyncOutbox(user.id)).length > 0) {
        setCloudStatus('local-only');
        return;
      }

      try {
        const remoteState = await loadCoreState(client, latestStateRef.current);
        setState(remoteState);
        latestStateRef.current = remoteState;
        lastSyncedStateRef.current = remoteState;
        revisionRef.current = nextRevisionFloor(revisionRef.current, remoteState.cloudRevision);
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
    }, true);
    if (!flushed || (await listSyncOutbox(user.id)).length > 0) return;
    setCloudStatus('ready');
    setSyncError(null);
    try {
      const remoteState = await loadCoreState(client, latestStateRef.current);
      latestStateRef.current = remoteState;
      lastSyncedStateRef.current = remoteState;
      revisionRef.current = nextRevisionFloor(revisionRef.current, remoteState.cloudRevision);
      setState(remoteState);
      void saveAppStateCache(remoteState, user.id);
    } catch (error) {
      console.warn('Post-sync retry refresh warning:', describeCloudError(error).message);
    }
  };

  /** Number of outbox entries still waiting for acknowledgment (0 = nothing pending). */
  const countPendingOperations = async (): Promise<number> => {
    if (!user) return 0;
    try {
      return (await listSyncOutbox(user.id)).length;
    } catch {
      return 0;
    }
  };

  /**
   * Force-flush the outbox once (used before signing out). Returns whether the queue is
   * empty afterwards; never throws, because the caller must still be able to sign out.
   */
  const flushOutboxNow = async (): Promise<boolean> => {
    if (!user) return true;
    const client = createSupabaseBrowserClient();
    if (!client) return false;
    try {
      await flushSyncOutbox(client, user.id, syncingRef, (error) => {
        console.warn('Sign-out flush warning:', describeCloudError(error).message);
      }, true);
      return (await listSyncOutbox(user.id)).length === 0;
    } catch (error) {
      console.warn('Sign-out flush failed:', describeCloudError(error).message);
      return false;
    }
  };

  // Durability when the tab is closed or backgrounded. The debounced save holds up to 300ms
  // of edits in memory only, so a tab that dies inside that window used to lose them. Here the
  // delta is written to the outbox first (IndexedDB, survives the unload) and only then is one
  // best-effort flush attempted — the browser may still kill the page mid-request, but the
  // work is already queued and will be retried on the next start.
  useEffect(() => {
    if (!user || typeof window === 'undefined') return;

    const persistPendingWork = () => {
      const scheduled = pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1;
      void (async () => {
        try {
          if (scheduled) {
            window.clearTimeout(pendingSaveTimerRef.current as number);
            pendingSaveTimerRef.current = null;
            const client = createSupabaseBrowserClient();
            // Without a synced baseline there is no meaningful delta to queue; the initial
            // load owns the state in that case, so only the flush below is attempted.
            if (client && lastSyncedStateRef.current && (await hasAuthenticatedOwner(client, user.id))) {
              // The cancelled timer will never run, so take over its job with the freshest
              // state and invalidate any in-flight save that still holds an older snapshot.
              saveGenerationRef.current += 1;
              revisionRef.current = Math.max(
                revisionRef.current + 1,
                nextRevisionFloor(latestStateRef.current.cloudRevision, lastSyncedStateRef.current?.cloudRevision),
              );
              updatedAtRef.current = new Date().toISOString();
              await enqueueSyncDelta(
                user.id,
                lastSyncedStateRef.current,
                latestStateRef.current,
                revisionRef.current,
                updatedAtRef.current,
              );
            }
          }
          const pendingOutboxCount = (await listSyncOutbox(user.id)).length;
          if (!shouldFlushOnBackground({
            pendingSaveScheduled: false,
            pendingOutboxCount,
            status: cloudStatusRef.current,
          })) return;
          await flushOutboxNow();
        } catch (error) {
          console.warn('Background persistence warning:', describeCloudError(error).message);
        }
      })();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') persistPendingWork();
    };
    window.addEventListener('pagehide', persistPendingWork);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', persistPendingWork);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  // Scoped to the authenticated user; the handler reads the live refs, not render values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /**
   * Settings escape hatch: drop unacknowledged local operations and reload the workspace
   * from the cloud. The user confirms this explicitly because queued edits are discarded.
   */
  const resyncFromCloud = async (): Promise<void> => {
    if (!user) throw new Error('لا يمكن إعادة المزامنة دون تسجيل الدخول.');
    const client = createSupabaseBrowserClient();
    if (!client) throw new Error('لا يمكن إعادة المزامنة دون اتصال بالخادم السحابي.');

    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }
    setCloudStatus('loading');
    setSyncError(null);
    try {
      await clearSyncOutbox(user.id);
      const remoteState = await loadCoreState(client, getEmptyState(), { pendingRecordIds: new Set() });
      latestStateRef.current = remoteState;
      lastSyncedStateRef.current = remoteState;
      if (typeof remoteState.cloudRevision === 'number' && remoteState.cloudRevision > revisionRef.current) {
        revisionRef.current = remoteState.cloudRevision;
      }
      setState(remoteState);
      await saveAppStateCache(remoteState, user.id);
      setLocalStorageError(null);
      setConflicts([]);
      setCloudStatus('ready');
    } catch (error) {
      const message = describeCloudError(error).message;
      setSyncError(message);
      setCloudStatus('sync-failed');
      throw error;
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
    // The user explicitly chose their local version: this is the only path allowed to
    // override a deletion recorded by another device.
    await enqueueSyncOperations(user.id, operations, revisionRef.current, new Date().toISOString(), {
      allowTombstoneOverride: true,
    });
    setConflicts((current) => current.filter((item) => item.outboxId !== conflict.outboxId));
    setCloudStatus('sync-pending');
    setSyncError(null);
    const flushed = await flushSyncOutbox(client, user.id, syncingRef, (error) => {
      setSyncError(describeCloudError(error).message);
      setCloudStatus(error instanceof SyncConflictError ? 'conflict' : 'sync-failed');
    }, true);
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
    localEditSeqRef.current += 1;
    if (user && (cloudStatus === 'ready' || cloudStatus === 'sync-failed')) {
      setCloudStatus('sync-pending');
      setSyncError(null);
    }
    const previous = latestStateRef.current;
    const next = updater(previous);
    const deletedRecordIds = getDeletedRecordIds(previous, next);
    const committedState = {
      ...next,
      deletedRecordIds: Array.from(new Set([
        ...(previous.deletedRecordIds || []),
        ...deletedRecordIds,
      ])),
    };
    latestStateRef.current = committedState;
    setState(committedState);
  };

  const updateStateAndWait = async (updater: (previous: AppState) => AppState): Promise<void> => {
    localEditSeqRef.current += 1;
    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }

    const previous = latestStateRef.current;
    const computed = updater(previous);
    const deletedRecordIds = getDeletedRecordIds(previous, computed);
    const nextState: AppState = {
      ...computed,
      deletedRecordIds: Array.from(new Set([
        ...(previous.deletedRecordIds || []),
        ...deletedRecordIds,
      ])),
    };
    latestStateRef.current = nextState;
    setState(nextState);
    void saveAppStateCache(nextState, user?.id);

    if (!user) return;

    setCloudStatus('sync-pending');
    setSyncError(null);

    revisionRef.current += 1;
    const revision = revisionRef.current;
    const updatedAt = new Date().toISOString();
    const syncedDeletedIds = new Set(nextState.deletedRecordIds || []);

    const client = createSupabaseBrowserClient();
    if (!client) {
      setCloudStatus('local-only');
      return;
    }

    try {
      await enqueueSyncDelta(user.id, lastSyncedStateRef.current, nextState, revision, updatedAt);
      const flushed = await flushSyncOutbox(client, user.id, syncingRef, (error) => {
        if (isLocalOnlyCloudError(error)) {
          setCloudStatus('local-only');
          return;
        }
        const message = describeCloudError(error).message;
        setSyncError(message);
        setCloudStatus(error instanceof Error && error.name === 'SyncConflictError' ? 'conflict' : 'sync-failed');
        void registerConflict(error);
        console.error('Cloud state save failed:', message);
      }, true);

      if (flushed && (await listSyncOutbox(user.id)).length === 0) {
        lastSyncedStateRef.current = nextState;
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
      }
    } catch (error) {
      const message = describeCloudError(error).message;
      setSyncError(message);
      setCloudStatus('sync-failed');
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
    await saveAppStateCache(normalizedState, user?.id);
    setLocalStorageError(null);
    if (user) await updateStateAndWait(() => normalizedState);
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

    latestStateRef.current = nextState;
    lastSyncedStateRef.current = nextState;
    setState(nextState);
    await saveAppStateCache(nextState, user?.id, { allowEmptyRoster: true });

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
    if (user) await clearMemorandaOutbox(user.id);
    await clearAvatarOutbox();
    await clearTeacherBinaryFiles(user?.id);
    await clearDashboardTasks();
    const emptyState = getEmptyState();
    await saveAppStateCache(emptyState, user?.id, { allowEmptyRoster: true });
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
    latestStateRef.current = nextState;
    setState(nextState);
    await saveAppStateCache(nextState, user?.id);
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
        latestStateRef.current = reconciledState;
        setState(reconciledState);
        await saveAppStateCache(reconciledState, user.id);
      }

      // 2. Profile updates if school name, academic year, or state changed
      if (nextState.profile && (nextState.profile.schoolName || nextState.profile.academicYear || nextState.profile.stateName)) {
        await (client as any).from('profiles').update({
          school_name: nextState.profile.schoolName || null,
          academic_year: nextState.profile.academicYear || null,
          state_name: nextState.profile.stateName || null,
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
    countPendingOperations,
    flushOutboxNow,
    resyncFromCloud,
    conflicts,
    resolveConflictKeepRemote,
    resolveConflictKeepLocal,
  };
}
