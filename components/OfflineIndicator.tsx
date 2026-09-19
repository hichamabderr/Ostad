"use client"
import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-6 left-4 z-[9999] flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-2xl animate-in slide-in-from-bottom-4 fade-in" dir="rtl">
      <WifiOff className="w-4 h-4 text-rose-400" />
      <span>وضع عدم الاتصال — يتم حفظ أعمالك محلياً.</span>
    </div>
  );
};
