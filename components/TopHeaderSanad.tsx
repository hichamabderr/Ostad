"use client";

import { AppState } from "@/lib/storage";
import { Calendar, Menu, Search } from "lucide-react";
import React, { useEffect } from "react";
import { PWAInstallButton } from "./PWAInstallButton";
import { SanadTab } from "./SidebarSanad";
import { selectActiveClass, selectStudentsByClass } from "@/lib/state-selectors";

interface TopHeaderSanadProps {
  currentTab: SanadTab;
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  onOpenSearch: () => void;
  onToggleMobileSidebar: () => void;
}

const TAB_TITLES: Record<SanadTab, { title: string; subtitle?: string }> = {
  dashboard: {
    title: "لوحة التحكم",
    subtitle: "متابعة الحصص والأفواج والمهام اليومية",
  },
  classes: {
    title: "الأقسام وقوائم التلاميذ",
    subtitle: "إدارة الأقسام والتلاميذ، والحصص",
  },
  attendance: {
    title: "التقويم المستمر والحضور",
    subtitle: "معايير التقويم المستمر (السلوك، الكراس، المشاركة، الغيابات)",
  },
  grades: {
    title: "دفتر النقاط",
    subtitle: "التقويم المستمر، الفروض، الاختبارات",
  },
  council: {
    title: "مجالس الأقسام",
    subtitle: "إحصائيات النتائج ونسب النجاح الرسمية",
  },
  sessions: {
    title: "دفتر النصوص",
    subtitle: "سجل الحصص اليومي ودفتر الملاحظات",
  },
  annual_dist: {
    title: "التوزيع السنوي",
    subtitle: "التدرج السنوي للتعلمات والمقاطع البيداغوجية",
  },
  curriculum: {
    title: "المنهاج",
    subtitle: "منهاج مادة العلوم الإسلامية المعتمد",
  },
  timetable: { title: "جدول التوقيت", subtitle: "شبكة الحصص الأسبوعية" },
  settings: { title: "الإعدادات", subtitle: "إعدادات التطبيق" },
  prep: {
    title: "المذكرات",
    subtitle: "الاطلاع على المذكرات التعليمية",
  },
  documents: {
    title: "الوثائق",
    subtitle: "تصدير الوثائق والتقارير جاهزة للطباعة",
  },
};

export const TopHeaderSanad: React.FC<TopHeaderSanadProps> = ({
  currentTab,
  state,
  onUpdateState,
  onOpenSearch,
  onToggleMobileSidebar,
}) => {
  const currentInfo = TAB_TITLES[currentTab] || { title: "معين" };
  const activeClass = selectActiveClass(state);
  const activeClassStudentCount = selectStudentsByClass(state, activeClass?.id ?? null).length;

  // Algerian date formatting
  const today = new Date();
  const dayNames = [
    "الأحد",
    "الإثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت",
  ];
  const monthNames = [
    "جانفي",
    "فيفري",
    "مارس",
    "أفريل",
    "ماي",
    "جوان",
    "جويلية",
    "أوت",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ];
  const gregorianDate = `${dayNames[today.getDay()]} ${today.getDate()} ${monthNames[today.getMonth()]} ${today.getFullYear()} م`;

  // Automatic Hijri date
  const hijriDate = (() => {
    try {
      const formatter = new Intl.DateTimeFormat("ar-DZ-u-ca-islamic-umalqura", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const formatted = formatter
        .format(today)
        .replace(/\s+/g, " ")
        .replace(/AH/gi, "هـ")
        .trim();
      return formatted.endsWith("هـ") ? formatted : `${formatted} هـ`;
    } catch {
      return state.profile.hijriYear || "1448 هـ";
    }
  })();

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  return (
    <header className="sticky top-0 z-30 print:hidden bg-[var(--bg-surface)]/90 backdrop-blur-xl supports-[backdrop-filter]:bg-[var(--bg-surface)]/80 border-b border-[var(--border-default)] transition-colors">
      <div className="h-16 px-3 sm:px-6 md:px-8 w-full max-w-[30rem] md:max-w-7xl mx-auto flex items-center justify-between gap-3 md:gap-4">
        {/* Right Side: Menu toggle & Page Title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onToggleMobileSidebar}
            className="p-2 rounded-xl lg:hidden text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-subtle)] transition-colors cursor-pointer shrink-0"
            aria-label="فتح القائمة">
            <Menu className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-black text-[var(--text-primary)] tracking-tight truncate leading-tight">
              {currentInfo.title}
            </h1>
            {currentInfo.subtitle && (
              <p className="text-[10px] text-[var(--text-tertiary)] hidden sm:block truncate leading-tight">
                {currentInfo.subtitle}
              </p>
            )}
            {activeClass && currentTab !== "dashboard" && (
              <div className="text-[10px] text-[var(--primary)] font-bold truncate mt-0.5">
                القسم الحالي: {activeClass.name} • {activeClassStudentCount} تلميذاً
              </div>
            )}
          </div>
        </div>

        {/* Left Side: Gregorian + Hijri Date + Search + Dark/Light + Backup */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Automatic Gregorian + Hijri Date */}
          <div className="hidden md:flex flex-col items-end pl-3 border-l border-[var(--border-default)] text-right">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
              <Calendar className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" />
              <span>{gregorianDate}</span>
            </div>
            <div className="text-[11px] font-amiri font-bold text-[var(--primary)]">
              {hijriDate}
            </div>
          </div>

          {/* Quick Search Button */}
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-subtle)] border border-[var(--border-default)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer shadow-xs whitespace-nowrap"
            title="بحث شامل (Ctrl+K)">
            <Search className="w-4 h-4 text-[var(--text-secondary)]" />
            <span className="hidden sm:inline font-medium">بحث</span>
            <kbd className="hidden lg:inline-block px-1.5 py-0.5 rounded bg-[var(--bg-surface-subtle)] border border-[var(--border-default)] text-[10px] font-mono text-[var(--text-secondary)]">
              Ctrl+K
            </kbd>
          </button>

          <PWAInstallButton />

        </div>
      </div>
    </header>
  );
};
