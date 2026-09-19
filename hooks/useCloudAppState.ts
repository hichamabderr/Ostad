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

    const channel = client
      .channel(`core-state:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classes', filter: `owner_id=eq.${user.id}` }, () => {
        void loadCoreState(client, latestStateRef.current)
          .then(setState)
          .catch((error) => {
            if (isLocalOnlyCloudError(error)) {
              setCloudStatus('local-only');
              return;
            }
            console.error('Realtime classes sync failed:', describeCloudError(error).message);
          });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students', filter: `owner_id=eq.${user.id}` }, () => {
        void loadCoreState(client, latestStateRef.current)
          .then(setState)
          .catch((error) => {
            if (isLocalOnlyCloudError(error)) {
              setCloudStatus('local-only');
              return;
            }
            console.error('Realtime students sync failed:', describeCloudError(error).message);
          });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'grades', filter: `owner_id=eq.${user.id}` }, () => {
        void loadCoreState(client, latestStateRef.current)
          .then(setState)
          .catch((error) => {
            if (isLocalOnlyCloudError(error)) {
              setCloudStatus('local-only');
              return;
            }
            console.error('Realtime grades sync failed:', describeCloudError(error).message);
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
    revisionRef.current += 1;
    updatedAtRef.current = new Date().toISOString();
    const revision = revisionRef.current;
    const updatedAt = updatedAtRef.current;
    const timer = window.setTimeout(() => {
      const client = createSupabaseBrowserClient();
      if (!client || syncingRef.current) return;
      syncingRef.current = true;
      void enqueueSyncState(user.id, state, revision, updatedAt)
        .then(() => listSyncOutbox(user.id))
        .then(async entries => {
          for (const entry of entries) {
            await saveCoreState(client, user.id, entry.state, {
              revision: entry.revision,
              updatedAt: entry.updatedAt,
              deviceId: getSyncDeviceId(),
            });
            await removeSyncOutboxEntry(entry.id);
          }
        })
        .catch((error) => {
          if (isLocalOnlyCloudError(error)) {
            setCloudStatus('local-only');
            return;
          }
          console.error('Cloud state save failed:', describeCloudError(error).message);
        })
        .finally(() => {
          syncingRef.current = false;
        });
    }, 700);
    return () => window.clearTimeout(timer);
  // user is read by the scheduled callback; changing its id also resets cloudReady.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudReady, cloudStatus, isMounted, state, user?.id]);

  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const retryWhenOnline = () => {
      const client = createSupabaseBrowserClient();
      if (!client) return;
      setCloudStatus('loading');
      void loadCoreState(client, latestStateRef.current)
        .then(remoteState => {
          setState(remoteState);
          latestStateRef.current = remoteState;
          setCloudStatus('ready');
        })
        .catch(error => {
          setCloudStatus('local-only');
          console.error('Cloud sync retry failed:', describeCloudError(error).message);
        });
    };
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
  // The retry listener is intentionally scoped to the authenticated user.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleUpdateState = (updater: (previous: AppState) => AppState) => {
    setState((previous) => updater(previous));
  };

  const replaceStateFromBackup = async (nextState: AppState): Promise<void> => {
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
