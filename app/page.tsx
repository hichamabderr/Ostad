'use client';

import React, { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useCloudAppState } from '@/hooks/useCloudAppState';
import { SidebarSanad, SanadTab } from '@/components/SidebarSanad';
import { TopHeaderSanad } from '@/components/TopHeaderSanad';
import { MobileNavigation } from '@/components/MobileNavigation';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { AuthGate } from '@/components/AuthGate';
import { CurriculumUnit } from '@/lib/types';

const ViewLoading = () => (
  <div className="flex min-h-64 items-center justify-center" aria-live="polite">
    <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
  </div>
);

const Dashboard = dynamic(() => import('@/components/Dashboard').then((mod) => mod.Dashboard), { ssr: false, loading: ViewLoading });
const ClassesManager = dynamic(() => import('@/components/ClassesManager').then((mod) => mod.ClassesManager), { ssr: false, loading: ViewLoading });
const AttendanceSanad = dynamic(() => import('@/components/AttendanceSanad').then((mod) => mod.AttendanceSanad), { ssr: false, loading: ViewLoading });
const GradesAndEvaluation = dynamic(() => import('@/components/GradesAndEvaluation').then((mod) => mod.GradesAndEvaluation), { ssr: false, loading: ViewLoading });
const CouncilAnalysis = dynamic(() => import('@/components/CouncilAnalysis').then((mod) => mod.CouncilAnalysis), { ssr: false, loading: ViewLoading });
const SessionCahier = dynamic(() => import('@/components/SessionCahier').then((mod) => mod.SessionCahier), { ssr: false, loading: ViewLoading });
const AnnualDistribution = dynamic(() => import('@/components/AnnualDistribution').then((mod) => mod.AnnualDistribution), { ssr: false, loading: ViewLoading });
const CurriculumView = dynamic(() => import('@/components/CurriculumView').then((mod) => mod.CurriculumView), { ssr: false, loading: ViewLoading });
const TimetableSanad = dynamic(() => import('@/components/TimetableSanad').then((mod) => mod.TimetableSanad), { ssr: false, loading: ViewLoading });
const SettingsSanad = dynamic(() => import('@/components/SettingsSanad').then((mod) => mod.SettingsSanad), { ssr: false, loading: ViewLoading });
const LessonPreparation = dynamic(() => import('@/components/LessonPreparation').then((mod) => mod.LessonPreparation), { ssr: false, loading: ViewLoading });
const DocumentsExport = dynamic(() => import('@/components/DocumentsExport').then((mod) => mod.DocumentsExport), { ssr: false, loading: ViewLoading });
const GlobalSearchModal = dynamic(() => import('@/components/GlobalSearchModal').then((mod) => mod.GlobalSearchModal), { ssr: false });

function AppContent({ user, onSignOut }: { user: User | null; onSignOut: () => void }) {
  const { state, handleUpdateState, replaceStateFromBackup, resetWorkspace, isMounted, cloudReady } = useCloudAppState(user);

  const [currentTab, setCurrentTab] = useState<SanadTab>(() => {
    if (typeof window === 'undefined') return 'dashboard';
    const tab = new URLSearchParams(window.location.search).get('tab');
    const validTabs: SanadTab[] = ['dashboard', 'classes', 'attendance', 'grades', 'council', 'sessions', 'annual_dist', 'curriculum', 'timetable', 'settings', 'prep', 'documents'];
    return validTabs.includes(tab as SanadTab) ? (tab as SanadTab) : 'dashboard';
  });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [prepUnit, setPrepUnit] = useState<CurriculumUnit | null>(null);
  const [prepTab, setPrepTab] = useState<'card' | 'pdf' | 'bank'>('card');

  // Keyboard shortcut Ctrl+K / Cmd+K for global search
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', currentTab);
    window.history.replaceState(null, '', url);
  }, [currentTab]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (state.activeClassId) {
      url.searchParams.set('class', state.activeClassId);
    } else {
      url.searchParams.delete('class');
    }

    window.history.replaceState(null, '', url);
  }, [state.activeClassId]);

  useEffect(() => {
    const handlePopState = () => {
      const tab = new URLSearchParams(window.location.search).get('tab');
      const validTabs: SanadTab[] = ['dashboard', 'classes', 'attendance', 'grades', 'council', 'sessions', 'annual_dist', 'curriculum', 'timetable', 'settings', 'prep', 'documents'];
      if (validTabs.includes(tab as SanadTab)) setCurrentTab(tab as SanadTab);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const classId = new URLSearchParams(window.location.search).get('class');
    if (classId && state.classes.some(cls => cls.id === classId) && state.activeClassId !== classId) {
      // Restore the last class context when opening a shared or bookmarked view.
      handleUpdateState(prev => ({ ...prev, activeClassId: classId }));
    }
  }, [handleUpdateState, state.activeClassId, state.classes]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      void navigator.serviceWorker.register('/sw.js').catch(error => {
        console.error('Service worker registration failed:', error);
      });
    };
    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(register, { timeout: 3000 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = globalThis.setTimeout(register, 1500);
    return () => globalThis.clearTimeout(timer);
  }, []);

  // Navigate to AI prep with unit preselected
  const handlePrepareUnit = (unit: CurriculumUnit, tab: 'card' | 'pdf' | 'bank' = 'card') => {
    setPrepUnit(unit);
    setPrepTab(tab);
    setCurrentTab('prep');
  };

  const isCollapsed = state.sidebarCollapsed || false;

  if (!isMounted || !cloudReady) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center" dir="rtl">
        <div className="flex flex-col items-center gap-5">
          <Image src="/pwa-192x192.png" alt="معين" width={72} height={72} className="rounded-2xl" priority />
          <div className="text-center">
            <div className="text-lg font-bold text-[#1A1C1E]">معين</div>
            <p className="text-xs text-[#8E95A0] mt-1">جاري التحميل...</p>
          </div>
          <div className="w-6 h-6 border-2 border-[#2E7D9B] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-row bg-[#F8F9FA] text-[#1A1C1E]"
      dir="rtl"
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:right-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-xl focus:bg-[var(--primary)] focus:text-white focus:text-xs focus:font-bold"
      >
        الانتقال إلى المحتوى الرئيسي
      </a>
      {/* 1. Official Sanad Al-Oustadh Right Sidebar (Desktop & Mobile Drawer) */}
      <SidebarSanad
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        state={state}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onSignOut={onSignOut}
        isCollapsed={isCollapsed}
        onToggleCollapse={() =>
          handleUpdateState(prev => ({
            ...prev,
            sidebarCollapsed: !prev.sidebarCollapsed
          }))
        }

      />

      {/* 2. Main Content Wrapper (offset by sidebar width on desktop) */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          isCollapsed ? 'md:mr-20' : 'md:mr-64'
        }`}
      >
        {/* Top Header Bar */}
        <TopHeaderSanad
          currentTab={currentTab}
          state={state}
          onUpdateState={handleUpdateState}
          onOpenSearch={() => setIsSearchOpen(true)}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(prev => !prev)}
        />

        {/* View Content Area (with bottom padding for Mobile Navigation bar) */}
        <main id="main-content" tabIndex={-1} className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-12">
          {currentTab === 'dashboard' && (
            <Dashboard
              state={state}
              onNavigate={setCurrentTab}
              onUpdateState={handleUpdateState}
              onResetWorkspace={resetWorkspace}
            />
          )}

          {currentTab === 'classes' && (
            <ClassesManager
              state={state}
              onUpdateState={handleUpdateState}
              onNavigate={setCurrentTab}
            />
          )}

          {currentTab === 'attendance' && (
            <AttendanceSanad
              state={state}
              onUpdateState={handleUpdateState}
              onNavigateToTimetable={() => setCurrentTab('timetable')}
              onNavigateToSessions={() => setCurrentTab('sessions')}
            />
          )}

          {currentTab === 'grades' && (
            <GradesAndEvaluation
              state={state}
              onUpdateState={handleUpdateState}
            />
          )}

          {currentTab === 'council' && (
            <CouncilAnalysis state={state} />
          )}

          {currentTab === 'sessions' && (
            <SessionCahier
              state={state}
              onUpdateState={handleUpdateState}
            />
          )}

          {currentTab === 'annual_dist' && (
            <AnnualDistribution
              state={state}
              onUpdateState={handleUpdateState}
            />
          )}

          {currentTab === 'curriculum' && (
            <CurriculumView
              state={state}
              onUpdateState={handleUpdateState}
              onPrepareUnit={handlePrepareUnit}
            />
          )}

          {currentTab === 'timetable' && (
            <TimetableSanad
              state={state}
              onUpdateState={handleUpdateState}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsSanad
              state={state}
              onUpdateState={handleUpdateState}
              onReplaceState={replaceStateFromBackup}
            />
          )}

          {currentTab === 'prep' && (
            <LessonPreparation
              state={state}
              onUpdateState={handleUpdateState}
              initialUnit={prepUnit}
              initialTab={prepTab}
            />
          )}

          {currentTab === 'documents' && (
            <DocumentsExport state={state} />
          )}
        </main>

        {/* Footer (Desktop & Tablet) */}
        <footer className="py-6 px-4 pb-24 md:pb-6 text-center text-xs border-t border-[#DEE2E6] bg-white print:hidden">
          <div className="max-w-7xl mx-auto flex flex-col items-center justify-center gap-1">
            <div className="font-bold text-sm text-[#1A1C1E] mb-1">معين</div>
            <div className="text-slate-500 font-medium">تطبيق مساعد لأستاذ العلوم الإسلامية في التعليم الثانوي</div>
            <div className="text-slate-600 font-bold mt-1">ثانوية الدكتور بن زرجب - تلمسان</div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">2026 - 2027</div>
          </div>
        </footer>
      </div>

      {/* 3. Mobile Navigation Bottom Bar (md:hidden) */}
      <MobileNavigation
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onOpenMobileMenu={() => setIsMobileSidebarOpen(true)}
        state={state}
        onUpdateState={handleUpdateState}
      />

      {/* 4. Global Search Modal (Ctrl+K) */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        state={state}
        onNavigate={setCurrentTab}
        onUpdateState={handleUpdateState}
        onPrepareUnit={handlePrepareUnit}
      />
      <OfflineIndicator />
    </div>
  );
}

export default function Page() {
  return <AuthGate>{(user, onSignOut) => <AppContent user={user} onSignOut={onSignOut} />}</AuthGate>;
}
