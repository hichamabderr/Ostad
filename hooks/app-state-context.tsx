'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { AppState } from '@/lib/storage';

export type AppStateUpdater = (updater: (previous: AppState) => AppState) => void;
export type AppStateSyncUpdater = (updater: (previous: AppState) => AppState) => Promise<void>;

export interface AppStateContextValue {
  state: AppState;
  updateState: AppStateUpdater;
  updateStateAndWait: AppStateSyncUpdater;
  replaceStateFromBackup: (state: AppState) => Promise<void>;
  clearRosterData: () => Promise<void>;
  resetWorkspace: () => Promise<void>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({
  value,
  children,
}: {
  value: AppStateContextValue;
  children: ReactNode;
}) {
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}
