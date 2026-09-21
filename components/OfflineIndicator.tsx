"use client"
import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { CloudOff, RefreshCw, WifiOff } from 'lucide-react';

type SyncStatus = 'loading' | 'ready' | 'sync-pending' | 'sync-failed' | 'conflict' | 'local-only';

export const OfflineIndicator: React.FC<{
  cloudStatus?: SyncStatus;
  syncError?: string | null;
  localStorageError?: string | null;
  onRetry?: () => void;
  onOpenConflict?: () => void;
}> = ({ cloudStatus = 'ready', syncError, localStorageError, onRetry, onOpenConflict }) => {
  const isOnline = useOnlineStatus();

  if (isOnline && cloudStatus === 'ready' && !localStorageError) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-6 left-4 z-[9999] flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-2xl animate-in slide-in-from-bottom-4 fade-in" dir="rtl">
      {localStorageError
        ? <CloudOff className="w-4 h-4 text-rose-400" />
        : isOnline
          ? <CloudOff className="w-4 h-4 text-rose-400" />
          : <WifiOff className="w-4 h-4 text-rose-400" />}
      <span>
        {localStorageError
          ? `خطأ في الحفظ المحلي — صدّر نسخة احتياطية فوراً: ${localStorageError}`
          : !isOnline
          ? 'وضع عدم الاتصال — يتم حفظ أعمالك محلياً.'
          : cloudStatus === 'loading'
            ? 'جارٍ مزامنة مساحة العمل...'
            : cloudStatus === 'sync-pending'
              ? 'تغييرات محلية بانتظار المزامنة...'
              : cloudStatus === 'conflict'
                ? `يوجد تعارض يحتاج إعادة المحاولة${syncError ? `: ${syncError}` : ''}`
                : cloudStatus === 'sync-failed'
                  ? `تعذرت المزامنة${syncError ? `: ${syncError}` : ''}`
                  : 'المزامنة السحابية متوقفة — تغييراتك محفوظة محلياً.'}
      </span>
      {isOnline && cloudStatus === 'conflict' && onOpenConflict && (
        <button type="button" onClick={onOpenConflict} className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-white/15 px-2 text-[11px] hover:bg-white/25">
          مراجعة
        </button>
      )}
      {isOnline && cloudStatus === 'sync-failed' && onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-white/15 px-2 text-[11px] hover:bg-white/25">
          <RefreshCw className="h-3.5 w-3.5" />
          إعادة المحاولة
        </button>
      )}
    </div>
  );
};
