import { get, set, keys, del } from 'idb-keyval';
import { getEmptyState, isDemoState, type AppState } from './storage';

const STATE_CACHE_KEY = 'sanad:app-state:v3';

/**
 * Strips huge inline base64 blobs and non-essential caches from state before writing to IndexedDB.
 * This guarantees the cached state stays small (<200KB) and avoids QuotaExceededError.
 */
export function sanitizeStateForCache(state: AppState): AppState {
  const sanitized: AppState = { ...state };

  if (sanitized.profile?.avatarUrl && sanitized.profile.avatarUrl.startsWith('data:') && sanitized.profile.avatarUrl.length > 50_000) {
    sanitized.profile = {
      ...sanitized.profile,
      avatarUrl: undefined,
    };
  }

  if (sanitized.unitPdfFiles) {
    const cleanPdfs: Record<string, any> = {};
    for (const [unitId, meta] of Object.entries(sanitized.unitPdfFiles)) {
      if (meta) {
        // Strip heavy base64 data URLs - metadata is sufficient for local cache
        const { fileDataUrl, ...rest } = meta as any;
        cleanPdfs[unitId] = rest;
      }
    }
    sanitized.unitPdfFiles = cleanPdfs;
  }

  return sanitized;
}

/**
 * Cleans up stale legacy keys and temporary bloat if quota is constrained.
 */
export async function cleanupStaleStorage(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const allKeys = await keys();
    const staleKeys = allKeys.filter((k) =>
      typeof k === 'string' && (
        k.startsWith('sanad:app-state:v1') ||
        k.startsWith('sanad:app-state:v2') ||
        k.startsWith('sanad:temp:')
      )
    );
    for (const key of staleKeys) {
      await del(key);
    }
  } catch (err) {
    console.warn('Storage cleanup warning:', err);
  }
}

export async function loadAppStateCache(): Promise<AppState | null> {
  if (typeof window === 'undefined') return null;
  try {
    return (await get<AppState>(STATE_CACHE_KEY)) ?? null;
  } catch (error) {
    console.error('Failed to load IndexedDB workspace cache:', error);
    return null;
  }
}

export async function saveAppStateCache(state: AppState, options?: { allowEmptyRoster?: boolean }): Promise<void> {
  if (typeof window === 'undefined') return;

  // Safeguard: Never overwrite a real user workspace cache with demo/mock state
  if (isDemoState(state)) {
    try {
      const existing = await get<AppState>(STATE_CACHE_KEY);
      if (existing && !isDemoState(existing) && (existing.classes.length > 0 || existing.students.length > 0)) {
        console.warn('Blocked attempt to overwrite real IndexedDB workspace cache with demo state.');
        return;
      }
    } catch {
      // Continue if lookup fails
    }
  }

  const sanitized = sanitizeStateForCache(state);

  try {
    await set(STATE_CACHE_KEY, sanitized);
  } catch (error) {
    const isQuota = error instanceof Error && (
      error.name === 'QuotaExceededError' ||
      error.message.includes('QuotaExceeded') ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    );

    if (isQuota) {
      console.warn('IndexedDB quota exceeded. Attempting storage cleanup and retry...');
      await cleanupStaleStorage();
      try {
        await set(STATE_CACHE_KEY, sanitized);
        return;
      } catch (retryError) {
        console.error('Failed to save IndexedDB workspace cache after cleanup:', retryError);
        // Fallback: save essential core roster (classes, students, grades) without auxiliary blobs
        const minimalState: AppState = {
          ...sanitized,
          unitPdfFiles: undefined,
          lessonPlans: [],
        };
        try {
          await set(STATE_CACHE_KEY, minimalState);
          return;
        } catch {
          throw new Error('مساحة تخزين المتصفح ممتلئة. تم الاعتماد على المزامنة السحابية.');
        }
      }
    }

    console.error('Failed to save IndexedDB workspace cache:', error);
    throw new Error('تعذر حفظ مساحة العمل المحلية. تحقق من مساحة التخزين.');
  }
}
