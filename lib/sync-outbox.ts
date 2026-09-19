import { del, get, keys, set } from 'idb-keyval';
import type { AppState } from './storage';

export interface SyncOutboxEntry {
  id: string;
  ownerId: string;
  revision: number;
  updatedAt: string;
  state: AppState;
  createdAt: string;
}

const OUTBOX_PREFIX = 'sanad:sync-outbox:';
const DEVICE_ID_KEY = 'sanad:sync-device-id';

function outboxKey(id: string): string {
  return `${OUTBOX_PREFIX}${id}`;
}

export function getSyncDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export async function enqueueSyncState(
  ownerId: string,
  state: AppState,
  revision: number,
  updatedAt: string,
): Promise<string> {
  const id = `${ownerId}:${revision}`;
  const entry: SyncOutboxEntry = {
    id,
    ownerId,
    revision,
    updatedAt,
    state,
    createdAt: new Date().toISOString(),
  };
  await set(outboxKey(id), entry);
  return id;
}

export async function listSyncOutbox(ownerId: string): Promise<SyncOutboxEntry[]> {
  const entries = await Promise.all(
    (await keys())
      .filter((key): key is string => typeof key === 'string' && key.startsWith(OUTBOX_PREFIX))
      .map(async key => get<SyncOutboxEntry>(key)),
  );
  return entries
    .filter((entry): entry is SyncOutboxEntry => Boolean(entry && entry.ownerId === ownerId))
    .sort((a, b) => a.revision - b.revision);
}

export async function removeSyncOutboxEntry(id: string): Promise<void> {
  await del(outboxKey(id));
}
