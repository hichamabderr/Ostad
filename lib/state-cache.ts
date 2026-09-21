import { get, set } from 'idb-keyval';
import type { AppState } from './storage';

const STATE_CACHE_KEY = 'sanad:app-state:v3';

export async function loadAppStateCache(): Promise<AppState | null> {
  if (typeof window === 'undefined') return null;
  try {
    return (await get<AppState>(STATE_CACHE_KEY)) ?? null;
  } catch (error) {
    console.error('Failed to load IndexedDB workspace cache:', error);
    throw new Error('تعذر تحميل مساحة العمل المحلية من IndexedDB');
  }
}

export async function saveAppStateCache(state: AppState): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await set(STATE_CACHE_KEY, state);
  } catch (error) {
    console.error('Failed to save IndexedDB workspace cache:', error);
    throw new Error('تعذر حفظ مساحة العمل المحلية. تحقق من مساحة التخزين.');
  }
}
