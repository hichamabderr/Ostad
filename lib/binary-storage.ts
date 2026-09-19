import { get, set, del, keys } from 'idb-keyval';

export async function saveBinaryFile(key: string, data: string): Promise<void> {
  try {
    await set(key, data);
  } catch (error) {
    console.error('Error saving binary file to IndexedDB:', error);
    throw error;
  }
}

export async function loadBinaryFile(key: string): Promise<string | undefined> {
  try {
    return await get<string>(key);
  } catch (error) {
    console.error('Error loading binary file from IndexedDB:', error);
    return undefined;
  }
}

export async function deleteBinaryFile(key: string): Promise<void> {
  try {
    await del(key);
  } catch (error) {
    console.error('Error deleting binary file from IndexedDB:', error);
    throw error;
  }
}

export async function listBinaryKeys(): Promise<string[]> {
  try {
    const allKeys = await keys();
    return allKeys.filter((k): k is string => typeof k === 'string');
  } catch (error) {
    console.error('Error listing binary keys from IndexedDB:', error);
    return [];
  }
}

export function binaryKeyForPdf(unitId: string): string {
  return `sanad:pdf:${unitId}`;
}

export function binaryKeyForAvatar(): string {
  return 'sanad:avatar:profile';
}
