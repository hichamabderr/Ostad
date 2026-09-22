"use client";

import { showToast } from "@/components/Toast";
import { useAppState } from '@/hooks/app-state-context';
import {
  AppState,
  DEFAULT_CALENDAR_SETTINGS,
  exportBackupJSON,
  importBackupJSON,
} from "@/lib/storage";
import { createPdfBackupArchive, restorePdfBackupArchive } from "@/lib/backup-archive";
import { AcademicCalendarSettings, OfficialHoliday } from "@/lib/types";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import React, { useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { ProfessionalProfile } from "./ProfessionalProfile";
import { PWAInstallButton } from "./PWAInstallButton";
import { ConfirmDialog } from "./ConfirmDialog";

interface SettingsSanadProps {
}

export const SettingsSanad: React.FC<SettingsSanadProps> = () => {
  const {
    state,
    updateStateAndWait,
    replaceStateFromBackup,
    clearRosterData,
  } = useAppState();
  const [calendarSettings, setCalendarSettings] =
    useState<AcademicCalendarSettings>(
      state.calendarSettings || DEFAULT_CALENDAR_SETTINGS,
    );
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [newHolidayName, setNewHolidayName] = useState("");
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayType, setNewHolidayType] = useState<
    "national" | "religious" | "term"
  >("national");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showHolidaysConfirm, setShowHolidaysConfirm] = useState(false);
  const [showSuccessMsg, setShowSuccessMsg] = useState("");
  const [pendingImportedState, setPendingImportedState] = useState<AppState | null>(null);
  const [isAddHolidayOpen, setIsAddHolidayOpen] = useState(false);
  const [holidayToDeleteId, setHolidayToDeleteId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfArchiveInputRef = useRef<HTMLInputElement>(null);

  const handleSaveSettings = () => {
    void updateStateAndWait((prev) => ({
      ...prev,
      calendarSettings,
    }))
      .then(() => {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
      })
      .catch((error: unknown) => {
        console.error("Calendar settings save failed:", error);
        showToast("تعذر حفظ إعدادات التقويم في السحابة.", "error");
      });
  };

  const handleClearClassesData = () => {
    setShowResetConfirm(true);
  };

  const confirmClearClassesData = async () => {
    try {
      await clearRosterData();
      setShowResetConfirm(false);
      setShowSuccessMsg("تمت إعادة تعيين الأقسام والتلاميذ ومزامنتها بنجاح.");
      showToast("تمت إعادة تعيين الأقسام والتلاميذ ومزامنتها بنجاح.", "success");
      setTimeout(() => setShowSuccessMsg(""), 3000);
    } catch (error) {
      console.error("Roster reset failed:", error);
      setShowResetConfirm(false);
      showToast("تعذر تأكيد إعادة تعيين الأقسام والتلاميذ في السحابة. يرجى التحقق من الاتصال وإعادة المحاولة.", "error");
    }
  };

  const handleResetHolidays = () => {
    setShowHolidaysConfirm(true);
  };

  const confirmResetHolidays = () => {
    setCalendarSettings((prev) => ({
      ...prev,
      holidays: DEFAULT_CALENDAR_SETTINGS.holidays,
    }));
    setShowHolidaysConfirm(false);
  };

  const handleAddHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHolidayName.trim()) return;

    const newH: OfficialHoliday = {
      id: `h-${uuidv4()}`,
      name: newHolidayName.trim(),
      dateStr: newHolidayDate || "تاريخ محدد",
      type: newHolidayType,
    };

    setCalendarSettings((prev) => ({
      ...prev,
      holidays: [...prev.holidays, newH],
    }));

    setNewHolidayName("");
    setNewHolidayDate("");
    setIsAddHolidayOpen(false);
  };

  const handleDeleteHoliday = (id: string) => {
    setCalendarSettings((prev) => ({
      ...prev,
      holidays: prev.holidays.filter((h) => h.id !== id),
    }));
    setHolidayToDeleteId(null);
  };

  const handleExportJSON = () => {
    const json = exportBackupJSON(state);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moeen-al-oustadh-backup-${state.profile.academicYear.replace("/", "-")}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const imported = importBackupJSON(text);
        setPendingImportedState(imported);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "خطأ غير متوقع";
        showToast(`فشل استيراد الملف: ${message}`, "error");
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };

    reader.readAsText(file);
  };

  const confirmImportJSON = async () => {
    if (!pendingImportedState) return;
    try {
      await replaceStateFromBackup(pendingImportedState);
      const hasPdfReferences = Object.values(pendingImportedState.unitPdfFiles || {})
        .some((file) => Boolean(file.fileStorageKey || file.fileDataUrl));
      setPendingImportedState(null);
      showToast(
        hasPdfReferences
          ? "تمت استعادة البيانات. استعد أرشيف PDF ZIP بشكل منفصل لإظهار الملفات المحلية."
          : "تمت استعادة البيانات بنجاح تام!",
        "success",
      );
    } catch (error) {
      console.error("Backup replacement failed:", error);
      showToast("تعذر استبدال البيانات الحالية. لم يتم إعلان نجاح الاستيراد.", "error");
    }
  };

  const handleExportPdfArchive = async () => {
    try {
      const archive = await createPdfBackupArchive(state);
      const url = URL.createObjectURL(new Blob([archive.buffer as ArrayBuffer], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `moeen-al-oustadh-pdfs-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("تم تصدير أرشيف ملفات PDF بنجاح.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "تعذر تصدير ملفات PDF.", "error");
    }
  };

  const handleImportPdfArchive = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const restored = await restorePdfBackupArchive(file);
      await updateStateAndWait(prev => ({
        ...prev,
        unitPdfFiles: { ...(prev.unitPdfFiles || {}), ...restored },
      }));
      showToast("تمت استعادة ملفات PDF بنجاح.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "تعذر استعادة ملفات PDF.", "error");
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div
      className="space-y-6 w-full max-w-[30rem] md:max-w-5xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6"
      id="sanad-settings-view">
      {/* Settings actions toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-stretch sm:items-center gap-2 flex-wrap">
        <div className="flex w-full sm:w-auto items-stretch sm:items-center gap-2 flex-col sm:flex-row">
          <PWAInstallButton />
          <button
            onClick={handleSaveSettings}
            className="w-full sm:w-auto min-h-11 flex items-center justify-center gap-2 px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer text-xs">
            <Save className="w-4 h-4" />
            <span>حفظ جميع الإعدادات</span>
          </button>
        </div>
      </div>

      {savedSuccess && (
        <div className="bg-[var(--primary-soft)] border border-[var(--primary)]/30 rounded-xl p-3 text-xs text-[var(--accent-navy)] font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[var(--primary)]" />
          <span>تم حفظ الإعدادات وقواعد الاحتساب بنجاح في التطبيق!</span>
        </div>
      )}

      {/* Section 0: Professional Profile */}
      <ProfessionalProfile />

      {/* Section 1: السنوات الدراسية والفصول (Screenshot 1) */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[var(--primary)]" />
              السنوات الدراسية والفصول
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              السنة الدراسية الحالية:{" "}
              <span className="font-bold text-[var(--primary)]">
                {state.profile.academicYear || "2026/2027"}
              </span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs pt-2">
          {/* Trimester 1 */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
            <div className="font-bold text-slate-800 text-sm flex items-center justify-between">
              <span>الفصل الأول</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary-soft)] text-[var(--accent-navy)] font-bold">
                نشط حالياً
              </span>
            </div>
            <div>
              <label className="block text-slate-500 mb-1">تاريخ البداية</label>
              <input
                type="date"
                value={calendarSettings.termDates.term1Start}
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    termDates: {
                      ...prev.termDates,
                      term1Start: e.target.value,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">تاريخ النهاية</label>
              <input
                type="date"
                value={calendarSettings.termDates.term1End}
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    termDates: { ...prev.termDates, term1End: e.target.value },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
              />
            </div>
          </div>

          {/* Trimester 2 */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
            <div className="font-bold text-slate-800 text-sm">الفصل الثاني</div>
            <div>
              <label className="block text-slate-500 mb-1">تاريخ البداية</label>
              <input
                type="date"
                value={calendarSettings.termDates.term2Start}
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    termDates: {
                      ...prev.termDates,
                      term2Start: e.target.value,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">تاريخ النهاية</label>
              <input
                type="date"
                value={calendarSettings.termDates.term2End}
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    termDates: { ...prev.termDates, term2End: e.target.value },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
              />
            </div>
          </div>

          {/* Trimester 3 */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
            <div className="font-bold text-slate-800 text-sm">الفصل الثالث</div>
            <div>
              <label className="block text-slate-500 mb-1">تاريخ البداية</label>
              <input
                type="date"
                value={calendarSettings.termDates.term3Start}
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    termDates: {
                      ...prev.termDates,
                      term3Start: e.target.value,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
              />
            </div>
            <div>
              <label className="block text-slate-500 mb-1">تاريخ النهاية</label>
              <input
                type="date"
                value={calendarSettings.termDates.term3End}
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    termDates: { ...prev.termDates, term3End: e.target.value },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: العطل والأيام المستثناة (Screenshot 2) */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--primary)]" />
              العطل والأيام المستثناة في الجزائر
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              تُستثنى هذه الأيام تلقائياً عند حساب وتوليد الحصص الأسبوعية في
              جدول التوقيت
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleResetHolidays}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer">
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              <span>استعادة الرزنامة الرسمية</span>
            </button>
            <button
              onClick={() => setIsAddHolidayOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--primary)] text-white rounded-xl text-xs font-bold hover:bg-[var(--primary-hover)] cursor-pointer shadow-xs">
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة عطلة</span>
            </button>
          </div>
        </div>

        {/* Holidays Badges Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2">
          {calendarSettings.holidays.map((holiday) => {
            const isNational = holiday.type === "national";
            const isReligious = holiday.type === "religious";
            const isTerm = holiday.type === "term";

            return (
              <div
                key={holiday.id}
                className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all text-xs group">
                <div className="space-y-1">
                  <div className="font-bold text-slate-800">{holiday.name}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span
                      className={`px-1.5 py-0.2 rounded-md font-semibold text-[10px] ${
                        isTerm
                          ? "bg-blue-100 text-navy"
                          : isNational
                            ? "bg-[var(--primary-soft)] text-[var(--accent-navy)]"
                            : "bg-purple-100 text-purple-800"
                      }`}>
                      {isTerm
                        ? "عطلة فصلية"
                        : isNational
                          ? "عطلة وطنية"
                          : "عطلة دينية"}
                    </span>
                    <span>{holiday.dateStr}</span>
                  </div>
                </div>

                <button
                  onClick={() => setHolidayToDeleteId(holiday.id)}
                  className="text-slate-300 hover:text-rose-600 p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  title="حذف">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 3: التقويم المستمر — قواعد التقويم المستمر */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[var(--primary)]" />
              <span>التقويم المستمر</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              قواعد التقويم المستمر: السلوك (5) | الغيابات (5) | تنظيم الكراس
              (5) | المشاركة (5)
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[var(--primary-soft)] border border-[var(--primary)]/30 text-[var(--accent-navy)] text-xs font-bold w-fit">
            <span>المجموع الإجمالي:</span>
            <span className="font-mono text-sm">20 / 20</span>
          </div>
        </div>

        {/* The 4 Criteria Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          {/* 1. السلوك (5) */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">
                1. السلوك
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 font-bold text-[var(--primary)]">
                5 / 5
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              الانضباط واحترام الحرم المدرسي. في حالة الشغب ينقص من السلوك.
            </p>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                خصم الشغب الواحد (نقاط):
              </label>
              <input
                type="number"
                step="0.25"
                min="0"
                max="5"
                value={
                  calendarSettings.evaluationRules.disruptionDeduction ?? 0.5
                }
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    evaluationRules: {
                      ...prev.evaluationRules,
                      disruptionDeduction: parseFloat(e.target.value) || 0,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                افتراضياً 0.5 نقطة لكل مخالفة شغب
              </span>
            </div>
          </div>

          {/* 2. الغيابات (5) */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">
                2. الغيابات
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 font-bold text-[var(--primary)]">
                5 / 5
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              المواظبة والحضور. في حالة الغياب غير المبرر يُخصم آلياً.
            </p>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                خصم الغياب غير المبرر (نقاط):
              </label>
              <input
                type="number"
                step="0.25"
                min="0"
                max="5"
                value={
                  calendarSettings.evaluationRules.unexcusedAbsenceDeduction ??
                  1.0
                }
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    evaluationRules: {
                      ...prev.evaluationRules,
                      unexcusedAbsenceDeduction:
                        parseFloat(e.target.value) || 0,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                افتراضياً 1 نقطة لكل غياب غير مبرر
              </span>
            </div>
          </div>

          {/* 3. تنظيم الكراس (5) */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">
                3. تنظيم الكراس
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 font-bold text-[var(--primary)]">
                5 / 5
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              كتابة الدروس والعناية بالدفتر. في حالة عدم كتابة الدروس ينقص من
              الكراس.
            </p>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                خصم عدم كتابة الدرس (نقاط):
              </label>
              <input
                type="number"
                step="0.25"
                min="0"
                max="5"
                value={
                  calendarSettings.evaluationRules.unwrittenLessonDeduction ??
                  1.0
                }
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    evaluationRules: {
                      ...prev.evaluationRules,
                      unwrittenLessonDeduction: parseFloat(e.target.value) || 0,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                افتراضياً 0.5 نقطة لكل درس لم يُكتب
              </span>
            </div>
          </div>

          {/* 4. المشاركة (5) */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">
                4. المشاركة
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 font-bold text-[var(--primary)]">
                5 / 5
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              التفاعل الصفي والإجابة والتحضير. تضاف كنقاط إضافية ولا يخصم
              لعدمها.
            </p>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                علاوة المشاركة الإيجابية (نقاط):
              </label>
              <input
                type="number"
                step="0.25"
                min="0"
                max="5"
                value={
                  calendarSettings.evaluationRules.participationBonus ?? 0.5
                }
                onChange={(e) =>
                  setCalendarSettings((prev) => ({
                    ...prev,
                    evaluationRules: {
                      ...prev.evaluationRules,
                      participationBonus: parseFloat(e.target.value) || 0,
                    },
                  }))
                }
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900 font-bold"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                افتراضياً 0.5 نقطة لكل مشاركة إيجابية
              </span>
            </div>
          </div>
        </div>

        {/* Options */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
          <input
            type="checkbox"
            id="guidance-alerts"
            checked={calendarSettings.evaluationRules.showGuidanceAlerts}
            onChange={(e) =>
              setCalendarSettings((prev) => ({
                ...prev,
                evaluationRules: {
                  ...prev.evaluationRules,
                  showGuidanceAlerts: e.target.checked,
                },
              }))
            }
            className="w-4 h-4 text-[var(--primary)] rounded cursor-pointer"
          />
          <label
            htmlFor="guidance-alerts"
            className="text-xs font-bold text-slate-700 cursor-pointer">
            إظهار تنبيهات الإرشاد البيداغوجي والتقديرات تلقائياً عند رصد النقاط
          </label>
        </div>
      </div>

      {/* Section 4: النسخ الاحتياطي واستعادة البيانات */}
      <div className="bg-white border border-slate-200/90 rounded-xl p-6 shadow-xs space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Download className="w-4 h-4 text-[var(--primary)]" />
            النسخ الاحتياطي وحفظ البيانات دون إنترنت
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            تطبيق «معين» يعمل بنمط Offline-First ويخزن بياناتك محلياً في متصفحك.
            يمكنك تنزيل نسخة احتياطية لنقلها لجهاز آخر في أي وقت.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2 flex-wrap">
          <button
            onClick={handleExportJSON}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-800 transition-colors shadow-xs cursor-pointer">
            <Download className="w-4 h-4 text-[var(--primary)]" />
            <span>تصدير نسخة احتياطية (ملف JSON)</span>
          </button>

          <button
            onClick={() => void handleExportPdfArchive()}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-800 transition-colors shadow-xs cursor-pointer">
            <Download className="w-4 h-4 text-[var(--primary)]" />
            <span>تصدير ملفات PDF (ZIP)</span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportJSON}
            accept=".json"
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-800 transition-colors shadow-xs cursor-pointer">
            <Upload className="w-4 h-4 text-[var(--primary)]" />
            <span>استعادة من نسخة احتياطية</span>
          </button>

          <input
            type="file"
            ref={pdfArchiveInputRef}
            onChange={handleImportPdfArchive}
            accept=".zip,application/zip"
            className="hidden"
          />

          <button
            onClick={() => pdfArchiveInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-800 transition-colors shadow-xs cursor-pointer">
            <Upload className="w-4 h-4 text-[var(--primary)]" />
            <span>استعادة ملفات PDF</span>
          </button>
        </div>
      </div>

      {/* Section 5: Danger Zone (منطقة العمليات الحساسة) */}
      <div className="bg-rose-50/70 border border-rose-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-rose-900">
          <AlertTriangle className="w-4 h-4 text-rose-600" />
          <span>منطقة العمليات الحساسة (Danger Zone)</span>
        </div>
        <p className="text-xs text-rose-700 leading-relaxed font-medium">
          هذا الإجراء يقوم بحذف جميع بيانات الأقسام، والتلاميذ، والغيابات، والعلامات بشكل نهائي، مع الإبقاء على ملفك المهني وجدول التوقيت.
        </p>
        <button
          onClick={handleClearClassesData}
          className="w-full sm:w-auto min-h-11 flex items-center justify-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer text-xs"
          title="يحذف فقط ما يتعلق بالأقسام، التلاميذ، الغيابات والعلامات مع الاحتفاظ بحسابك وجدول التوقيت">
          <RotateCcw className="w-4 h-4" />
          <span>إعادة تعيين الأقسام والتلاميذ...</span>
        </button>
      </div>

      {/* Add Holiday Modal */}
      {isAddHolidayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white rounded-xl max-w-md w-full p-5 shadow-xl border border-slate-200 text-right space-y-4">
            <h3 className="font-bold text-slate-900 text-sm">إضافة عطلة</h3>

            <form onSubmit={handleAddHoliday} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  اسم العطلة
                </label>
                <input
                  type="text"
                  required
                  value={newHolidayName}
                  onChange={(e) => setNewHolidayName(e.target.value)}
                  placeholder="مثال: زيارة بيداغوجية / ندوة تربوية"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  التاريخ / الفترة
                </label>
                <input
                  type="text"
                  value={newHolidayDate}
                  onChange={(e) => setNewHolidayDate(e.target.value)}
                  placeholder="مثال: 15 أفريل 2027"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  النوع
                </label>
                <select
                  value={newHolidayType}
                  onChange={(e) =>
                    setNewHolidayType(
                      e.target.value as "national" | "religious" | "term",
                    )
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-slate-900">
                  <option value="national">عطلة وطنية</option>
                  <option value="religious">عطلة دينية</option>
                  <option value="term">عطلة فصلية / مدرسية</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddHolidayOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200 font-bold cursor-pointer">
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[var(--primary)] text-white font-bold rounded-xl hover:bg-[var(--primary-hover)] cursor-pointer">
                  إضافة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Modals */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-rose-50 border-b border-rose-100 p-4 flex items-center gap-3">
              <div className="p-2 bg-rose-100 text-rose-700 rounded-full">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-rose-900">
                إعادة تعيين الأقسام
              </h3>
            </div>
            <div className="p-5 text-sm text-slate-700 leading-relaxed font-bold">
              هل أنت متأكد؟ سيتم مسح جميع بيانات الأقسام، والتلاميذ، والغيابات،
              والعلامات بشكل نهائي.
              <br />
              <br />
              <span className="text-slate-500 font-normal">
                ملاحظة: سيتم الإبقاء على ملفك المهني، وإعدادات التطبيق،
                والمذكرات والتحاضير البيداغوجية.
              </span>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-200 transition-colors text-sm cursor-pointer">
                إلغاء
              </button>
              <button
                onClick={confirmClearClassesData}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold transition-colors text-sm shadow-sm cursor-pointer">
                نعم، مسح البيانات
              </button>
            </div>
          </div>
        </div>
      )}

      {showHolidaysConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-amber-50 border-b border-amber-100 p-4 flex items-center gap-3">
              <div className="p-2 bg-amber-100 text-amber-700 rounded-full">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-amber-900">
                استعادة قائمة العطل
              </h3>
            </div>
            <div className="p-5 text-sm text-slate-700 leading-relaxed font-bold">
              هل ترغب في استعادة قائمة العطل الرسمية المعتمدة لوزارة التربية
              الوطنية؟ سيتم إلغاء أي تعديلات قمت بها.
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowHolidaysConfirm(false)}
                className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-200 transition-colors text-sm cursor-pointer">
                إلغاء
              </button>
              <button
                onClick={confirmResetHolidays}
                className="px-4 py-2 rounded-xl bg-gold hover:bg-amber-700 text-white font-bold transition-colors text-sm shadow-sm cursor-pointer">
                نعم، استعادة
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccessMsg && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] bg-[var(--primary)] text-white px-6 py-3 rounded-xl shadow-xl flex items-center gap-3 animate-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-bold text-sm">{showSuccessMsg}</span>
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(holidayToDeleteId)}
        title="تأكيد حذف العطلة"
        message="هل أنت متأكد من حذف هذه العطلة من الرزنامة؟"
        onCancel={() => setHolidayToDeleteId(null)}
        onConfirm={() => {
          if (holidayToDeleteId) {
            handleDeleteHoliday(holidayToDeleteId);
          }
        }}
      />
      <ConfirmDialog
        isOpen={Boolean(pendingImportedState)}
        title="استبدال بيانات التطبيق"
        message="سيتم استبدال الحالة الحالية بالنسخة المستوردة، وحذف عمليات المزامنة المحلية القديمة حتى لا تعود بيانات سابقة فوق النسخة الجديدة. ملفات PDF المحلية تحتاج إلى استعادة ملف ZIP بشكل منفصل."
        onCancel={() => setPendingImportedState(null)}
        onConfirm={() => void confirmImportJSON()}
      />
    </div>
  );
};
