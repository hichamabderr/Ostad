"use client";

import React, { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import dynamic from "next/dynamic";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCloudAppState } from "@/hooks/useCloudAppState";
import { AppStateProvider } from "@/hooks/app-state-context";
import { SidebarSanad, SanadTab } from "@/components/SidebarSanad";
import { TopHeaderSanad } from "@/components/TopHeaderSanad";
import { MobileNavigation } from "@/components/MobileNavigation";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { SyncConflictDialog } from "@/components/SyncConflictDialog";
import { AuthGate } from "@/components/AuthGate";
import { ComingSoon } from "@/components/ComingSoon";
import { CurriculumUnit } from "@/lib/types";

const MAINTENANCE_MODE = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === "true";

const ViewLoading = () => (
  <div className="flex min-h-64 items-center justify-center" aria-live="polite">
    <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
  </div>
);

const Dashboard = dynamic(
  () => import("@/components/Dashboard").then((mod) => mod.Dashboard),
  { ssr: false, loading: ViewLoading },
);
const ClassesManager = dynamic(
  () => import("@/components/ClassesManager").then((mod) => mod.ClassesManager),
  { ssr: false, loading: ViewLoading },
);
const AttendanceSanad = dynamic(
  () =>
    import("@/components/AttendanceSanad").then((mod) => mod.AttendanceSanad),
  { ssr: false, loading: ViewLoading },
);
const GradesAndEvaluation = dynamic(
  () =>
    import("@/components/GradesAndEvaluation").then(
      (mod) => mod.GradesAndEvaluation,
    ),
  { ssr: false, loading: ViewLoading },
);
const CouncilAnalysis = dynamic(
  () =>
    import("@/components/CouncilAnalysis").then((mod) => mod.CouncilAnalysis),
  { ssr: false, loading: ViewLoading },
);
const SessionCahier = dynamic(
  () => import("@/components/SessionCahier").then((mod) => mod.SessionCahier),
  { ssr: false, loading: ViewLoading },
);
const AnnualDistribution = dynamic(
  () =>
    import("@/components/AnnualDistribution").then(
      (mod) => mod.AnnualDistribution,
    ),
  { ssr: false, loading: ViewLoading },
);
const CurriculumView = dynamic(
  () => import("@/components/CurriculumView").then((mod) => mod.CurriculumView),
  { ssr: false, loading: ViewLoading },
);
const TimetableSanad = dynamic(
  () => import("@/components/TimetableSanad").then((mod) => mod.TimetableSanad),
  { ssr: false, loading: ViewLoading },
);
const SettingsSanad = dynamic(
  () => import("@/components/SettingsSanad").then((mod) => mod.SettingsSanad),
  { ssr: false, loading: ViewLoading },
);
const LessonPreparation = dynamic(
  () =>
    import("@/components/LessonPreparation").then(
      (mod) => mod.LessonPreparation,
    ),
  { ssr: false, loading: ViewLoading },
);
const DocumentsExport = dynamic(
  () =>
    import("@/components/DocumentsExport").then((mod) => mod.DocumentsExport),
  { ssr: false, loading: ViewLoading },
);
const GlobalSearchModal = dynamic(
  () =>
    import("@/components/GlobalSearchModal").then(
      (mod) => mod.GlobalSearchModal,
    ),
  { ssr: false },
);

const TAB_ROUTES: Record<SanadTab, string> = {
  dashboard: "/dashboard",
  classes: "/classes",
  students: "/students",
  attendance: "/attendance",
  grades: "/grades",
  council: "/council",
  sessions: "/sessions",
  annual_dist: "/annual-distribution",
  curriculum: "/curriculum",
  timetable: "/timetable",
  settings: "/settings",
  prep: "/lesson-preparation",
  documents: "/documents",
};

const ROUTE_TABS = Object.entries(TAB_ROUTES).reduce<Record<string, SanadTab>>(
  (result, [tab, route]) => {
    result[route] = tab as SanadTab;
    return result;
  },
  {},
);

function AppContent({
  user,
  onSignOut,
}: {
  user: User | null;
  onSignOut: () => void;
}) {
  const {
    state,
    handleUpdateState,
    updateStateAndWait,
    replaceStateFromBackup,
    commitRosterImport,
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
  } = useCloudAppState(user);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [isConflictOpen, setIsConflictOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const currentTab = ROUTE_TABS[pathname] ?? "dashboard";
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [prepUnit, setPrepUnit] = useState<CurriculumUnit | null>(null);
  const [prepTab, setPrepTab] = useState<"card" | "pdf" | "bank">("card");
  const [selectedSessionForCahier, setSelectedSessionForCahier] = useState<string | null>(null);

  const setCurrentTab = (tab: SanadTab) => {
    router.push(TAB_ROUTES[tab]);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      void navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Service worker registration failed:", error);
      });
    };
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(register, { timeout: 3000 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = globalThis.setTimeout(register, 1500);
    return () => globalThis.clearTimeout(timer);
  }, []);

  // Navigate to AI prep with unit preselected
  const handlePrepareUnit = (
    unit: CurriculumUnit,
    tab: "card" | "pdf" | "bank" = "card",
  ) => {
    setPrepUnit(unit);
    setPrepTab(tab);
    setCurrentTab("prep");
  };

  const isCollapsed = state.sidebarCollapsed || false;
  const hasLoadedData = state.classes.length > 0 || state.students.length > 0 || Boolean(state.profile?.name && state.profile.name !== 'أستاذ المادة');
  if (!isMounted || (!cloudReady && !hasLoadedData)) {
    return (
      <div
        className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center"
        dir="rtl">
        <div className="flex flex-col items-center gap-5">
          <Image
            src="/pwa-192x192.png"
            alt="معين"
            width={72}
            height={72}
            className="rounded-2xl"
            priority
          />
          <div className="text-center">
            <div className="text-lg font-bold text-[var(--text-primary)]">
              معين
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              جاري التحميل...
            </p>
          </div>
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <AppStateProvider value={{
      state,
      updateState: handleUpdateState,
      updateStateAndWait,
      replaceStateFromBackup,
      commitRosterImport,
      clearRosterData,
      resetWorkspace,
      conflicts,
      resolveConflictKeepRemote,
      resolveConflictKeepLocal,
    }}>
    <div
      className="min-h-screen flex flex-row bg-[var(--bg-page)] text-[var(--text-primary)]"
      dir="rtl">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:right-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-xl focus:bg-[var(--primary)] focus:text-white focus:text-xs focus:font-bold">
        الانتقال إلى المحتوى الرئيسي
      </a>
      {/* 1. Official Sanad Al-Oustadh Right Sidebar (Desktop & Mobile Drawer) */}
      <SidebarSanad
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onSignOut={onSignOut}
        isCollapsed={isCollapsed}
        onToggleCollapse={() =>
          handleUpdateState((prev) => ({
            ...prev,
            sidebarCollapsed: !prev.sidebarCollapsed,
          }))
        }
      />

      {/* 2. Main Content Wrapper (offset by sidebar width on desktop) */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          isCollapsed ? "md:mr-20" : "md:mr-64"
        }`}>
        {/* Top Header Bar */}
        <TopHeaderSanad
          currentTab={currentTab}
          onOpenSearch={() => setIsSearchOpen(true)}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
          cloudStatus={cloudStatus}
          syncError={syncError}
          onRetrySync={retrySync}
        />

        {/* View Content Area (with bottom padding for Mobile Navigation bar) */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-12">
          {currentTab === "dashboard" && (
            <Dashboard
              onNavigate={setCurrentTab}
            />
          )}

          {currentTab === "classes" && (
            <ClassesManager
              onNavigate={setCurrentTab}
              initialSubTab="classes"
            />
          )}

          {currentTab === "students" && (
            <ClassesManager
              onNavigate={setCurrentTab}
              initialSubTab="students"
            />
          )}

          {currentTab === "attendance" && (
            <AttendanceSanad
              onNavigateToTimetable={() => setCurrentTab("timetable")}
              onNavigateToSessions={(sessionId) => {
                setSelectedSessionForCahier(sessionId || null);
                setCurrentTab("sessions");
              }}
            />
          )}

          {currentTab === "grades" && (
            <GradesAndEvaluation
            />
          )}

          {currentTab === "council" && <CouncilAnalysis />}

          {currentTab === "sessions" && (
            <SessionCahier
              initialSessionId={selectedSessionForCahier || undefined}
              onClearInitialSession={() => setSelectedSessionForCahier(null)}
            />
          )}

          {currentTab === "annual_dist" && (
            <AnnualDistribution
            />
          )}

          {currentTab === "curriculum" && (
            <CurriculumView
              onPrepareUnit={handlePrepareUnit}
            />
          )}

          {currentTab === "timetable" && (
            <TimetableSanad />
          )}

          {currentTab === "settings" && (
            <SettingsSanad
            />
          )}

          {currentTab === "prep" && (
            <LessonPreparation
              initialUnit={prepUnit}
              initialTab={prepTab}
            />
          )}

          {currentTab === "documents" && <DocumentsExport />}
        </main>

        {/* Footer (Desktop & Tablet) */}
        <footer className="border-[var(--border-default)] bg-white px-4 py-6 pb-24 text-center text-xs md:pb-6 print:hidden">
          <div className="max-w-7xl mx-auto flex flex-col items-center justify-center gap-1">
            <div className="mb-1 text-sm font-bold text-[var(--text-primary)]">
              معين
            </div>
            <div className="text-slate-500 font-medium">
              تطبيق مساعد لأستاذ العلوم الإسلامية في التعليم الثانوي
            </div>
            {state.profile.schoolName ? (
              <div className="text-slate-600 font-bold mt-1">
                {state.profile.schoolName}{state.profile.stateName ? ` - ${state.profile.stateName}` : ''}
              </div>
            ) : (
              <div className="text-slate-400 font-medium text-xs mt-1">
                الطور الثانوي • وزارة التربية الوطنية
              </div>
            )}
            <div className="text-[10px] text-slate-400 font-mono mt-0.5">
              2026 - 2027
            </div>
          </div>
        </footer>
      </div>

      {/* 3. Mobile Navigation Bottom Bar (md:hidden) */}
      <MobileNavigation
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onOpenMobileMenu={() => setIsMobileSidebarOpen(true)}
      />

      {/* 4. Global Search Modal (Ctrl+K) */}
      <GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigate={setCurrentTab}
        onPrepareUnit={handlePrepareUnit}
      />
      <OfflineIndicator
        cloudStatus={cloudStatus}
        syncError={syncError}
        localStorageError={localStorageError}
        onRetry={retrySync}
        onOpenConflict={() => setIsConflictOpen(true)}
      />
      <SyncConflictDialog
        conflict={isConflictOpen ? conflicts[0] || null : null}
        busy={conflictBusy}
        onKeepRemote={async () => {
          setConflictBusy(true);
          setConflictError(null);
          try {
            if (conflicts[0]) await resolveConflictKeepRemote(conflicts[0]);
            setIsConflictOpen(false);
          } catch (error) {
            setConflictError(error instanceof Error ? error.message : "تعذر حل التعارض.");
          } finally { setConflictBusy(false); }
        }}
        onKeepLocal={async () => {
          setConflictBusy(true);
          setConflictError(null);
          try {
            if (conflicts[0]) await resolveConflictKeepLocal(conflicts[0]);
            setIsConflictOpen(false);
          } catch (error) {
            setConflictError(error instanceof Error ? error.message : "تعذر حل التعارض.");
          } finally { setConflictBusy(false); }
        }}
      />
      {conflictError && <div role="alert" className="fixed bottom-4 left-4 z-[10001] rounded-xl bg-rose-700 px-4 py-2 text-sm font-bold text-white">{conflictError}</div>}
    </div>
    </AppStateProvider>
  );
}

export default function Page() {
  return (
    <AuthGate>
      {(user, onSignOut) => <AppContent key={user?.id || 'anon'} user={user} onSignOut={onSignOut} />}
    </AuthGate>
  );
}
