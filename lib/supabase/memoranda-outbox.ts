import { del, get, keys, set } from 'idb-keyval';

export type MemorandaOutboxOperation =
  | {
      id: string;
      action: 'upload';
      unitId: string;
      fileName: string;
      file: Blob;
      createdAt: string;
    }
  | {
      id: string;
      action: 'delete';
      storagePath: string;
      createdAt: string;
    };

const PREFIX = 'sanad:memoranda-outbox:';

export async function enqueueMemorandaUpload(unitId: string, file: File): Promise<void> {
  const id = `upload:${unitId}`;
  await set(`${PREFIX}${id}`, {
    id,
    action: 'upload',
    unitId,
    fileName: file.name,
    file,
    createdAt: new Date().toISOString(),
  } satisfies MemorandaOutboxOperation);
}

export async function enqueueMemorandaDelete(storagePath: string): Promise<void> {
  const id = `delete:${storagePath}`;
  await set(`${PREFIX}${id}`, {
    id,
    action: 'delete',
    storagePath,
    createdAt: new Date().toISOString(),
  } satisfies MemorandaOutboxOperation);
}

export async function cancelMemorandaUpload(unitId: string): Promise<void> {
  await del(`${PREFIX}upload:${unitId}`);
}

export async function listMemorandaOutbox(): Promise<MemorandaOutboxOperation[]> {
  const entries = await Promise.all(
    (await keys())
      .filter((key): key is string => typeof key === 'string' && key.startsWith(PREFIX))
      .map((key) => get<MemorandaOutboxOperation>(key)),
  );
  return entries
    .filter((entry): entry is MemorandaOutboxOperation => Boolean(entry?.id && entry.action))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeMemorandaOutboxEntry(id: string): Promise<void> {
  await del(`${PREFIX}${id}`);
}

export async function clearMemorandaOutbox(): Promise<void> {
  await Promise.all((await listMemorandaOutbox()).map((entry) => removeMemorandaOutboxEntry(entry.id)));
}
