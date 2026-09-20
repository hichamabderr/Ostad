'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { getEmptyState, loadAppState, saveAppState } from '@/lib/storage';
import { clearTeacherBinaryFiles } from '@/lib/binary-storage';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { loadCoreState, resetCloudWorkspace, saveCoreState } from '@/lib/supabase/core-sync';
import {
  enqueueSyncState,
  getSyncDeviceId,
  listSyncOutbox,
  removeSyncOutboxEntry,
  clearSyncOutbox,
} from '@/lib/sync-outbox';
import type { AppState } from '@/lib/storage';

type CloudSyncStatus = 'loading' | 'ready' | 'local-only';
const WORKSPACE_OWNER_KEY = 'sanad:workspace-owner';

function describeCloudError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === 'object') {
    const candidate = error as { message?: string; details?: string; hint?: string; code?: string; status?: number };
    const parts = [candidate.message, candidate.details, candidate.hint, candidate.code && `code=${candidate.code}`, candidate.status && `status=${candidate.status}`]
      .filter(Boolean)
      .join(' | ');
    if (parts) return new Error(parts);
  }
  return new Error('تعذر الوصول إلى بيانات Supabase. تحقق من تطبيق migration والصلاحيات وRLS.');
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

async function flushSyncOutbox(
  client: ReturnType<typeof createSupabaseBrowserClient>,
  ownerId: string,
  syncingRef: { current: boolean },
  onError: (error: unknown) => void,
): Promise<boolean> {
  if (!client || syncingRef.current) return false;

  syncingRef.current = true;
  let completed = false;
  try {
    while (true) {
      const entries = await listSyncOutbox(ownerId);
      const entry = entries[0];
      if (!entry) {
        completed = true;
        return true;
      }

      await saveCoreState(client, ownerId, entry.state, {
        revision: entry.revision,
        updatedAt: entry.updatedAt,
        deviceId: getSyncDeviceId(),
      });
      await removeSyncOutboxEntry(entry.id);
    }
  } catch (error) {
    onError(error);
    return false;
  } finally {
    syncingRef.current = false;
    if (completed) {
      void listSyncOutbox(ownerId)
        .then((entries) => {
          if (entries.length > 0) {
            void flushSyncOutbox(client, ownerId, syncingRef, onError);
          }
        })
        .catch(onError);
    }
  }
}

export function useCloudAppState(user: User | null) {
  const [state, setState] = useState<AppState>(() => {
    const localState = loadAppState();
    if (typeof window === 'undefined' || !user) return localState;
    const cachedOwner = window.localStorage.getItem(WORKSPACE_OWNER_KEY);
    return cachedOwner && cachedOwner !== user.id ? getEmptyState() : localState;
  });
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>(() => (user ? 'loading' : 'ready'));
  const cloudReady = !user || cloudStatus !== 'loading';
  const syncingRef = useRef(false);
  const pendingSaveTimerRef = useRef<number | null>(null);
  const saveGenerationRef = useRef(0);
  const latestStateRef = useRef(state);
  const revisionRef = useRef(0);
  const updatedAtRef = useRef(new Date(0).toISOString());

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!isMounted) return;
    const timer = window.setTimeout(() => {
      try {
        saveAppState(state);
        if (user) window.localStorage.setItem(WORKSPACE_OWNER_KEY, user.id);
      } catch (error) {
        console.error('Local state save failed:', error);
      }
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
    window.setTimeout(() => {
      if (active) setCloudStatus('loading');
    }, 0);
    void loadCoreState(client, state)
      .then((remoteState) => {
        if (!active) return;
        setState(remoteState);
        latestStateRef.current = remoteState;
        window.localStorage.setItem(WORKSPACE_OWNER_KEY, user.id);
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
      if (syncingRef.current || pendingSaveTimerRef.current !== null || (await listSyncOutbox(user.id)).length > 0) return;

      const remoteState = await loadCoreState(client, latestStateRef.current);
      latestStateRef.current = remoteState;
      setState(remoteState);
    };

    const channel = client
      .channel(`core-state:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classes', filter: `owner_id=eq.${user.id}` }, () => {
        void refreshRemoteState()
          .catch((error) => {
            if (isLocalOnlyCloudError(error)) {
              setCloudStatus('local-only');
              return;
            }
            console.error('Realtime classes sync failed:', describeCloudError(error).message);
          });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students', filter: `owner_id=eq.${user.id}` }, () => {
        void refreshRemoteState()
          .catch((error) => {
            if (isLocalOnlyCloudError(error)) {
              setCloudStatus('local-only');
              return;
            }
            console.error('Realtime students sync failed:', describeCloudError(error).message);
          });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grades', filter: `owner_id=eq.${user.id}` }, () => {
        void refreshRemoteState()
          .catch((error) => {
            if (isLocalOnlyCloudError(error)) {
              setCloudStatus('local-only');
              return;
            }
            console.error('Realtime grades sync failed:', describeCloudError(error).message);
          });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter: `owner_id=eq.${user.id}` }, () => {
        void refreshRemoteState()
          .catch((error) => {
            if (isLocalOnlyCloudError(error)) {
              setCloudStatus('local-only');
              return;
            }
            console.error('Realtime app settings sync failed:', describeCloudError(error).message);
          });
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') console.error('Realtime subscription failed');
      });

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  // The subscription is intentionally scoped to the authenticated user.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!isMounted || !cloudReady) return;
    if (!user) return;
    if (cloudStatus === 'local-only') return;
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
      void enqueueSyncState(user.id, state, revision, updatedAt)
        .then(() => flushSyncOutbox(client, user.id, syncingRef, (error) => {
          if (isLocalOnlyCloudError(error)) {
            setCloudStatus('local-only');
            return;
          }
          console.error('Cloud state save failed:', describeCloudError(error).message);
        }))
        .then(async (flushed) => {
          if (!flushed || (await listSyncOutbox(user.id)).length > 0) return;
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

  const handleUpdateState = (updater: (previous: AppState) => AppState) => {
    setState((previous) => {
      const next = updater(previous);
      
      const prevIds = new Set([
        ...previous.classes.map(c => c.id),
        ...previous.students.map(s => s.id),
        ...previous.grades.map(g => g.id),
        ...previous.sessions.map(s => s.id),
        ...previous.timetable.map(t => t.id),
        ...previous.lessonProgress.map(progress => progress.id),
        ...previous.customUnits.map(unit => unit.id),
        ...previous.lessonPlans.map(plan => plan.id),
      ]);
      const nextIds = new Set([
        ...next.classes.map(c => c.id),
        ...next.students.map(s => s.id),
        ...next.grades.map(g => g.id),
        ...next.sessions.map(s => s.id),
        ...next.timetable.map(t => t.id),
        ...next.lessonProgress.map(progress => progress.id),
        ...next.customUnits.map(unit => unit.id),
        ...next.lessonPlans.map(plan => plan.id),
      ]);
      const newlyDeleted = [...prevIds].filter(id => !nextIds.has(id));
      
      if (newlyDeleted.length > 0) {
        return {
          ...next,
          deletedRecordIds: Array.from(new Set([
            ...(previous.deletedRecordIds || []),
            ...newlyDeleted,
          ])),
        };
      }
      
      return {
        ...next,
        deletedRecordIds: previous.deletedRecordIds || []
      };
    });
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
      activeClassId: nextState.classes.some((item) => item.id === nextState.activeClassId)
        ? nextState.activeClassId
        : nextState.classes[0]?.id || null,
    };
    setState(normalizedState);
    latestStateRef.current = normalizedState;
    saveAppState(normalizedState);
  };

  const resetWorkspace = async (): Promise<void> => {
    saveGenerationRef.current += 1;
    if (pendingSaveTimerRef.current !== null && pendingSaveTimerRef.current !== -1) {
      window.clearTimeout(pendingSaveTimerRef.current);
      pendingSaveTimerRef.current = null;
    }
    if (user) {
      const client = createSupabaseBrowserClient();
      if (!client) throw new Error('لا يمكن تنظيف مساحة الحساب دون اتصال Supabase.');
      await resetCloudWorkspace(client, user.id);
      await clearSyncOutbox(user.id);
    }
    await clearTeacherBinaryFiles();
    if (typeof window !== 'undefined') {
      localStorage.removeItem('sanad_urgent_tasks');
    }
    const emptyState = getEmptyState();
    saveAppState(emptyState);
    if (user && typeof window !== 'undefined') {
      window.localStorage.setItem(WORKSPACE_OWNER_KEY, user.id);
    }
    setState(emptyState);
    latestStateRef.current = emptyState;
    revisionRef.current = 0;
  };

  return {
    state,
    handleUpdateState,
    replaceStateFromBackup,
    resetWorkspace,
    isMounted,
    cloudReady,
    cloudStatus,
  };
}
