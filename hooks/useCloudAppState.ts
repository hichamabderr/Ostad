'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { getEmptyState } from '@/lib/storage';
import { loadAppStateCache, saveAppStateCache } from '@/lib/state-cache';
import { clearTeacherBinaryFiles } from '@/lib/binary-storage';
import { clearDashboardTasks } from '@/lib/dashboard-tasks';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { applySyncOutboxEntry, loadCoreState, resetCloudWorkspace, SyncConflictError } from '@/lib/supabase/core-sync';
import { flushMemorandaOutbox } from '@/lib/supabase/memoranda-storage';
import {
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

  return new Error('تعذر الوصول إلى بيانات Supabase. تحقق من تطبيق migration والصلاحيات وRLS.');
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
      .filter((record) => !nextIds.has(record.id))
      .map((record) => `${entity}:${record.id}`);
  });
  for (const session of previous.sessions) {
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
        completed = true;
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
          if (entries.length > 0) {
            void flushSyncOutbox(client, ownerId, syncingRef, onError);
          }
        })
        .catch(onError);
    }
  }
}

export function useCloudAppState(user: User | null) {
  const [state, setState] = useState<AppState>(() => getEmptyState());
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>(() => (user ? 'loading' : 'ready'));
  const [syncError, setSyncError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SyncConflictDescriptor[]>([]);
  const cloudStatusRef = useRef<CloudSyncStatus>(cloudStatus);
  const [localStorageError, setLocalStorageError] = useState<string | null>(null);
  const cloudReady = !user || cloudStatus !== 'loading';
  const syncingRef = useRef(false);
  const pendingSaveTimerRef = useRef<number | null>(null);
  const saveGenerationRef = useRef(0);
  const latestStateRef = useRef(state);
  const revisionRef = useRef(0);
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
    cloudStatusRef.current = cloudStatus;
  }, [cloudStatus]);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (user) return;
    let active = true;
    void loadAppStateCache()
      .then((cachedState) => {
        if (!active || !cachedState) return;
        latestStateRef.current = cachedState;
        setState(cachedState);
      })
      .catch((error) => {
        setLocalStorageError(error instanceof Error ? error.message : 'تعذر تحميل النسخة المحلية.');
        console.error('Local workspace load failed:', error);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!isMounted) return;
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
    window.setTimeout(() => {
      if (active) setCloudStatus('loading');
    }, 0);
    void loadCoreState(client, state)
      .then((remoteState) => {
        if (!active) return;
        setState(remoteState);
        latestStateRef.current = remoteState;
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
      }, () => {
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
      void client.removeChannel(channel);
    };
  // The subscription is intentionally scoped to the authenticated user.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!isMounted || !cloudReady) return;
    if (!user) return;
    if (cloudStatus === 'local-only' || cloudStatus === 'sync-failed' || cloudStatus === 'conflict') return;
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
          const message = describeCloudError(error).message;
          setSyncError(message);
          setCloudStatus(error instanceof Error && error.name === 'SyncConflictError' ? 'conflict' : 'sync-failed');
          void registerConflict(error);
          console.error('Cloud state save failed:', message);
        }))
        .then(async (flushed) => {
          if (!flushed || (await listSyncOutbox(user.id)).length > 0) return;
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
      void registerConflict(error);
    });
    if (!flushed || (await listSyncOutbox(user.id)).length > 0) return;
    try {
      const remoteState = await loadCoreState(client, latestStateRef.current);
      latestStateRef.current = remoteState;
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
    if (!user) throw new Error('لا يمكن حل التعارض دون تسجيل الدخول إلى Supabase.');
    const client = createSupabaseBrowserClient();
    if (!client) throw new Error('لا يمكن حل التعارض دون اتصال Supabase.');
    await removeSyncOutboxEntry(conflict.outboxId);
    const remoteState = await loadCoreState(client, latestStateRef.current);
    latestStateRef.current = remoteState;
    setState(remoteState);
    setConflicts((current) => current.filter((item) => item.outboxId !== conflict.outboxId));
    setSyncError(null);
    setCloudStatus('ready');
  };

  const resolveConflictKeepLocal = async (conflict: SyncConflictDescriptor): Promise<void> => {
    if (!user) throw new Error('لا يمكن حل التعارض دون تسجيل الدخول إلى Supabase.');
    const client = createSupabaseBrowserClient();
    if (!client) throw new Error('لا يمكن حل التعارض دون اتصال Supabase.');
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
    setState(remoteState);
    setCloudStatus('ready');
  };

  const handleUpdateState = (updater: (previous: AppState) => AppState) => {
    if (user && cloudStatus === 'ready') setCloudStatus('sync-pending');
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
      throw new Error('لا يمكن إعلان نجاح سحابي قبل تسجيل الدخول إلى Supabase.');
    }
    const currentStatus = cloudStatusRef.current;
    if (currentStatus === 'sync-failed' || currentStatus === 'conflict') {
      throw new Error('توجد عملية مزامنة فاشلة أو متعارضة. أعد المحاولة قبل حفظ تغيير جديد.');
    }

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const deadline = Date.now() + 30_000;
    let observedPendingWork = false;
    while (Date.now() < deadline) {
      const pending = await listSyncOutbox(user.id);
      const status = cloudStatusRef.current;
      if (pending.length > 0 || status === 'sync-pending' || status === 'loading') {
        observedPendingWork = true;
      }
      if (status === 'sync-failed' || status === 'conflict' || status === 'local-only') {
        throw new Error(syncError || 'تعذر تأكيد الحفظ في Supabase.');
      }
      if (observedPendingWork && status === 'ready' && pending.length === 0) {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    throw new Error('انتهت مهلة تأكيد الحفظ في Supabase. بقيت العملية في طابور المزامنة.');
  };

  const updateStateAndWait = async (updater: (previous: AppState) => AppState): Promise<void> => {
    handleUpdateState(updater);
    await waitForSyncConfirmation();
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

    const previousState = latestStateRef.current;
    const nextState: AppState = {
      ...previousState,
      classes: [],
      students: [],
      sessions: [],
      grades: [],
      lessonProgress: [],
      activeClassId: null,
      deletedRecordIds: Array.from(new Set([
        ...(previousState.deletedRecordIds || []),
        ...getDeletedRecordIds(previousState, {
          ...previousState,
          classes: [],
          students: [],
          sessions: [],
          grades: [],
          lessonProgress: [],
          activeClassId: null,
        }),
      ])),
    };

    setState(nextState);
    latestStateRef.current = nextState;
    await saveAppStateCache(nextState);

    if (!user) return;
    const client = createSupabaseBrowserClient();
    if (!client) throw new Error('لا يمكن مزامنة إعادة التعيين دون اتصال Supabase.');

    setCloudStatus('sync-pending');
    revisionRef.current += 1;
    const revision = revisionRef.current;
    const updatedAt = new Date().toISOString();
    const entryId = await enqueueSyncState(user.id, nextState, revision, updatedAt);
    const flushed = await flushSyncOutbox(client, user.id, syncingRef, (error) => {
      const message = describeCloudError(error).message;
      setSyncError(message);
      setCloudStatus(error instanceof Error && error.name === 'SyncConflictError' ? 'conflict' : 'sync-failed');
      void registerConflict(error);
    });
    if (!flushed || (await listSyncOutbox(user.id)).length > 0) {
      throw new Error('تعذر تأكيد حذف الأقسام والتلاميذ في Supabase.');
    }

    await removeSyncOutboxEntry(entryId);
    setSyncError(null);
    setCloudStatus('ready');
    setState((current) => ({
      ...current,
      deletedRecordIds: current.deletedRecordIds?.filter((id) => !nextState.deletedRecordIds?.includes(id)) || [],
    }));
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
    await clearMemorandaOutbox();
    await clearAvatarOutbox();
    await clearTeacherBinaryFiles();
    await clearDashboardTasks();
    const emptyState = getEmptyState();
    await saveAppStateCache(emptyState);
    setLocalStorageError(null);
    setState(emptyState);
    latestStateRef.current = emptyState;
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
