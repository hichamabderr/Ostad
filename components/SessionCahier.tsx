'use client';

import { ConfirmDialog } from './ConfirmDialog';
import { useAppState } from '@/hooks/app-state-context';
import { showToast } from "@/components/Toast";
import React, { useEffect, useState, useRef } from 'react';
import { AppState } from '@/lib/storage';
import { getLocalDateString } from '@/lib/date-utils';
import { CurriculumUnit, SessionRecord } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import { getMergedCurriculumUnits } from '@/lib/curriculum-data';
import {
  CalendarCheck,
  CheckCircle2,
  Clock,
  BookOpen,
  Users,
  Lightbulb,
  Plus,
  Save,
  Trash2,
  Calendar,
  AlertCircle,
  HelpCircle,
  Sparkles,
  ArrowRight,
  History,
  FileText,
  Search,
  Bold,
  List,
  ListOrdered,
  Quote,
  Check,
  ChevronDown,
  FileDown
} from 'lucide-react';
import { exportToDoc } from '@/lib/utils';

interface SessionCahierProps {
}

interface FormattingBarProps {
  val: string;
  setter: React.Dispatch<React.SetStateAction<string>>;
}

const FormattingBar: React.FC<FormattingBarProps> = ({ setter }) => {
  const handleApply = (prefix: string, suffix: string = '') => {
    setter(prev => {
      if (!prev) return `${prefix}${suffix}`;
      return `${prev}\n${prefix}${suffix}`;
    });
  };

  return (
    <div className="flex items-center gap-1 bg-slate-50 border-b border-slate-200 px-2 py-1.5 rounded-t-xl text-slate-600 text-xs overflow-x-auto scrollbar-none">
      <button
        type="button" onClick={() => handleApply('**', '**')}
        className="min-h-[36px] px-2.5 py-1 rounded-lg hover:bg-slate-200 font-bold flex items-center gap-1 cursor-pointer transition-colors shrink-0" title="نص عريض" >
        <Bold className="w-3.5 h-3.5" />
        <span className="text-xs">عريض</span>
      </button>
      <button
        type="button" onClick={() => handleApply('﴿ ', ' ﴾')}
        className="min-h-[36px] px-2.5 py-1 rounded-lg hover:bg-[var(--primary-soft)] text-[var(--primary)] font-bold cursor-pointer transition-colors shrink-0 text-xs" title="إدراج قوس آية قرآنية" >
        ﴿ آية ﴾
      </button>
      <button
        type="button" onClick={() => handleApply('« ', ' »')}
        className="min-h-[36px] px-2.5 py-1 rounded-lg hover:bg-blue-100 text-blue-800 font-bold cursor-pointer transition-colors shrink-0 text-xs" title="إدراج قوس حديث نبوي" >
        « حديث »
      </button>
      <button
        type="button" onClick={() => handleApply('• ')}
        className="min-h-[36px] px-2.5 py-1 rounded-lg hover:bg-slate-200 flex items-center gap-1 cursor-pointer transition-colors shrink-0" title="نقطة تعداد" >
        <List className="w-3.5 h-3.5" />
        <span className="text-xs">نقطة</span>
      </button>
      <button
        type="button" onClick={() => handleApply('1. ')}
        className="min-h-[36px] px-2.5 py-1 rounded-lg hover:bg-slate-200 flex items-center gap-1 cursor-pointer transition-colors shrink-0" title="ترقيم" >
        <ListOrdered className="w-3.5 h-3.5" />
        <span className="text-xs">ترقيم</span>
      </button>
    </div>
  );
};

// Helper to extract official objectives from curriculum database
function getObjectivesFromUnit(unit: CurriculumUnit): string {
  const parts: string[] = [];
  if (unit.learningObjective) {
    parts.push(`• الهدف التعلمي الأساسي: ${unit.learningObjective}`);
  }
  if (unit.targetedCompetence) {
    parts.push(`• الكفاءة المستهدفة: ${unit.targetedCompetence}`);
  }
  if (unit.targetedResources && unit.targetedResources.length > 0) {
    parts.push(`• الموارد المعرفية والمفاهيمية المستهدفة:`);
    unit.targetedResources.forEach(res => parts.push(`  - ${res}`));
  }
  if (unit.indicators && unit.indicators.length > 0) {
    parts.push(`• مؤشرات الكفاءة والتقويم:`);
    unit.indicators.forEach(ind => parts.push(`  - ${ind}`));
  }
  if (unit.referenceTexts && unit.referenceTexts.length > 0) {
    parts.push(`• السندات الشرعية المؤطرة:`);
    unit.referenceTexts.forEach(txt => parts.push(`  « ${txt} »`));
  }
  return parts.join('\n');
}

export const SessionCahier: React.FC<SessionCahierProps> = () => {
  const { state, updateStateAndWait } = useAppState();
  const activeClass = state.classes.find(c => c.id === state.activeClassId);

  const availableUnits = getMergedCurriculumUnits(state.customUnits).filter(
    u => u.level === activeClass?.level
  );
  // Active form state for logging a session
  const todayStr = getLocalDateString();
  const [sessionDate, setSessionDate] = useState(todayStr);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('09:00');
  const [selectedUnitId, setSelectedUnitId] = useState<string>(
    availableUnits[0]?.id || '' );
  const effectiveSelectedUnitId = availableUnits.some(unit => unit.id === selectedUnitId)
    ? selectedUnitId
    : availableUnits[0]?.id || '';
  const selectedUnitObj = availableUnits.find(u => u.id === effectiveSelectedUnitId);
  const sessionGoals = selectedUnitObj ? getObjectivesFromUnit(selectedUnitObj) : '';
  const [accomplishments, setAccomplishments] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  // The notebook uses one unified text area. Legacy fields are read through
  // getSessionNotes so existing records remain visible after the migration.
  const [notes, setNotes] = useState('');

  // Curriculum Extraction Modal State
  const [curriculumSearch, setCurriculumSearch] = useState('');
  const [selectedSectionFilter, setSelectedSectionFilter] = useState<number | 'all'>('all');

  const [savedSuccessMsg, setSavedSuccessMsg] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const getSessionNotes = (session: SessionRecord): string => {
    if (session.notes) return session.notes;
    if (session.teacherNotes) return session.teacherNotes;

    return [
      session.memoryWhatWorked && `ما نجح: ${session.memoryWhatWorked}`,
      session.memoryDifficulty && `الصعوبات: ${session.memoryDifficulty}`,
      session.memoryWhatFailed && `ما يحتاج تحسيناً: ${session.memoryWhatFailed}`,
      session.memoryNextTimeChange &&
        `التعديل المقترح للحصة القادمة: ${session.memoryNextTimeChange}`,
    ]
      .filter(Boolean)
      .join('\n');
  };

  // Helper for applying markdown or symbols into a specific state field
  const applyFormat = (
    getter: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    prefix: string,
    suffix: string = '' ) => {
    setter(prev => {
      if (!prev) return `${prefix}${suffix}`;
      return `${prev}\n${prefix}${suffix}`;
    });
  };

  // When selected unit changes, fill objectives automatically from curriculum DB
  const handleSelectUnit = (unitId: string) => {
    setSelectedUnitId(unitId);
  };

  const handleSessionDateChange = (date: string) => {
    setSessionDate(date);
    if (!date || !activeClass) return;

    const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
    const linkedSlot = state.timetable
      .filter(slot => slot.classId === activeClass.id && slot.dayOfWeek === dayOfWeek)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
    if (linkedSlot) {
      setStartTime(linkedSlot.startTime);
      setEndTime(linkedSlot.endTime);
    }
  };

  // Check if the teacher has prior notes for this selected unit
  const previousMemoryForThisUnit = state.sessions.find(
    s => s.unitId === effectiveSelectedUnitId && (
      getSessionNotes(s)
    )
  );

  // Save Session
  const handleSaveSession = async () => {
    if (!state.activeClassId) {
      showToast('يرجى تحديد القسم أولاً', 'error');
      return;
    }

    const newSession: SessionRecord = {
      id: `ses-${uuidv4()}`,
      classId: state.activeClassId,
      unitId: effectiveSelectedUnitId,
      date: sessionDate,
      startTime,
      endTime,
      sessionGoals,
      accomplishments,
      nextSteps,
      teacherNotes: '',
      notes,
      attendance: {}
    };

    try {
      await updateStateAndWait(prev => {
      const existingProgIdx = prev.lessonProgress.findIndex(
        p => p.classId === prev.activeClassId && p.unitId === effectiveSelectedUnitId
      );
      let newProg = [...prev.lessonProgress];
      if (existingProgIdx >= 0) {
        newProg[existingProgIdx] = {
          ...newProg[existingProgIdx],
          status: 'COMPLETED',
          completedAt: sessionDate
        };
      } else {
        newProg.push({
          id: `prog-${uuidv4()}`,
          classId: prev.activeClassId!,
          unitId: effectiveSelectedUnitId,
          status: 'COMPLETED',
          completedAt: sessionDate
        });
      }

      return {
        ...prev,
        sessions: [newSession, ...prev.sessions],
        lessonProgress: newProg
      };
      });

      setSavedSuccessMsg(true);
      setTimeout(() => setSavedSuccessMsg(false), 3500);
      setAccomplishments('');
      setNextSteps('');
      setNotes('');
    } catch (error) {
      console.error('Session save failed:', error);
      showToast('تعذر حفظ الحصة في السحابة.', 'error');
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await updateStateAndWait(prev => ({
        ...prev,
        sessions: prev.sessions.filter(s => s.id !== sessionId)
      }));
      setDeleteConfirmId(null);
    } catch (error) {
      console.error('Session delete failed:', error);
      showToast('تعذر حذف الحصة من السحابة.', 'error');
    }
  };

  const classPastSessions = state.sessions.filter(
    s => s.classId === state.activeClassId
  );

  // Export Cahier de texte to Word (.doc)

  const handleExportMarkdown = () => {
    let mdContent = `# دفتر النصوص - قسم ${activeClass?.name}

`;
    classPastSessions.forEach((s, idx) => {
      const unitObj = availableUnits.find(u => u.id === s.unitId);
      const title = unitObj?.title || s.customTopic || 'حصة تعلمية';
      const domain = unitObj?.domain || '—';
      const timeSlot = s.startTime && s.endTime ? `${s.startTime} - ${s.endTime}` : (s.startTime || '—');

      mdContent += `## الحصة رقم ${classPastSessions.length - idx}: ${title} (${s.date})
`;
      mdContent += `- التوقيت: ${timeSlot}
`;
      mdContent += `- الميدان: ${domain}
`;
      
      if (s.sessionGoals) mdContent += `
### أهداف الحصة
${s.sessionGoals}
`;
      if (s.accomplishments) mdContent += `
### ما تم إنجازه وبناؤه في الحصة
${s.accomplishments}
`;
      if (s.nextSteps) mdContent += `
### المعالجة والواجبات
${s.nextSteps}
`;
      const sessionNotes = getSessionNotes(s);
      if (sessionNotes) mdContent += `
### دفتر الملاحظات
${sessionNotes}
`;
      mdContent += `
---

`;
    });

    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `دفتر_النصوص_${activeClass?.name || 'القسم'}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportCahierDoc = () => {
    const rowsHtml = classPastSessions.map((s, idx) => {
      const unitObj = availableUnits.find(u => u.id === s.unitId);
      const title = unitObj?.title || s.customTopic || 'حصة تعلمية';
      const domain = unitObj?.domain || '—';
      const timeSlot = s.startTime && s.endTime ? `${s.startTime} - ${s.endTime}` : (s.startTime || '—');
      return `
        <tr>
          <td style="border: 1px solid #94a3b8; padding: 6px; text-align: center; font-weight: bold;">${classPastSessions.length - idx}</td>
          <td style="border: 1px solid #94a3b8; padding: 6px; text-align: center;">${s.date}</td>
          <td style="border: 1px solid #94a3b8; padding: 6px; text-align: center;">${timeSlot}</td>
          <td style="border: 1px solid #94a3b8; padding: 6px; text-align: right;"><strong>${title}</strong></td>
          <td style="border: 1px solid #94a3b8; padding: 6px; text-align: right;">${domain}</td>
        </tr>
      `;
    }).join('');

    const detailsHtml = classPastSessions.map((s, idx) => {
      const unitObj = availableUnits.find(u => u.id === s.unitId);
      const title = unitObj?.title || s.customTopic || 'حصة تعلمية';
      const domain = unitObj?.domain || '—';
      const timeSlot = s.startTime && s.endTime ? `${s.startTime} - ${s.endTime}` : (s.startTime || '—');
      return `
        <div style="margin-bottom: 25px; border-bottom: 2px solid #e2e8f0; padding-bottom: 15px;">
          <h3 style="color: #0d2c3b;">الحصة رقم ${classPastSessions.length - idx}: ${title} (${s.date})</h3>
          <p><strong>التوقيت:</strong> ${timeSlot} | <strong>الميدان:</strong> ${domain}</p>
          ${s.sessionGoals ? `<h4>أهداف الحصة:</h4><p style="white-space: pre-wrap;">${s.sessionGoals}</p>` : ''}
          ${s.accomplishments ? `<h4>ما تم إنجازه وبناؤه في الحصة:</h4><p style="white-space: pre-wrap;">${s.accomplishments}</p>` : ''}
          ${s.nextSteps ? `<h4>المعالجة والواجبات:</h4><p style="white-space: pre-wrap;">${s.nextSteps}</p>` : ''}
          ${getSessionNotes(s) ? `<h4>دفتر الملاحظات:</h4><p style="white-space: pre-wrap;">${getSessionNotes(s)}</p>` : ''}
        </div>
      `;
    }).join('');

    const html = `
      <div dir="rtl" style="text-align: center; margin-bottom: 10px;">
        <div style="color: var(--primary);">دفتر النصوص وسجل الحصص اليومي — مادة العلوم الإسلامية</div>
        <p><strong>المؤسسة:</strong> ${state.profile?.schoolName || 'ثانوية التعليم الثانوي'} | <strong>الأستاذ(ة):</strong> ${state.profile?.name || 'أستاذ المادة'} | <strong>السنة الدراسية:</strong> ${state.profile?.academicYear || '2025/2026'}</p>
        <p><strong>الفوج التربوي:</strong> ${activeClass?.name || 'القسم'} (${activeClass?.stream || ''}) | <strong>عدد الحصص الموثقة:</strong> ${classPastSessions.length}</p>
      </div>
      <h3 style="margin: 8px 0 4px;">جدول الحصص المنجزة زمنياً:</h3>
      <table dir="rtl" style="width: 100%; border-collapse: collapse; margin-top: 4px;">
        <thead>
          <tr style="background-color: #f1f5f9; font-weight: bold;">
            <th style="border: 1px solid #94a3b8; padding: 6px; text-align: center; width: 8%;">الرقم</th>
            <th style="border: 1px solid #94a3b8; padding: 6px; text-align: center; width: 16%;">التاريخ</th>
            <th style="border: 1px solid #94a3b8; padding: 6px; text-align: center; width: 16%;">التوقيت</th>
            <th style="border: 1px solid #94a3b8; padding: 6px; text-align: right; width: 38%;">عنوان الوحدة / الدرس</th>
            <th style="border: 1px solid #94a3b8; padding: 6px; text-align: right; width: 22%;">الميدان</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
      <h3 style="margin: 8px 0 4px;">تفاصيل وسير الحصص المسجلة:</h3>
      ${detailsHtml}
    `;

    exportToDoc(html, `دفتر_نصوص_${activeClass?.name || 'القسم'}`);
  };

  // Export the unified notebook to Word (.doc)
  const handleExportNotesDoc = () => {
    const noteSessions = classPastSessions.filter(s => getSessionNotes(s));

    const noteRows = noteSessions.map((s, idx) => {
      const unitObj = availableUnits.find(u => u.id === s.unitId);
      const title = unitObj?.title || s.customTopic || 'حصة تعلمية';
      return `
        <div style="margin-bottom: 25px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 15px; background-color: #fafaf9;">
          <h3 style="color: #0d2c3b; margin-top: 0;">الحصة ${idx + 1}: ${title} — ${s.date}</h3>
          <p style="white-space: pre-wrap;"><strong>ملاحظات الحصة:</strong><br/>${getSessionNotes(s)}</p>
        </div>
      `;
    }).join('');

    const html = `
      <div dir="rtl" style="text-align: center; margin-bottom: 10px;">
        <div style="color: #b45309;">دفتر الملاحظات للأستاذ</div>
        <p><strong>الأستاذ(ة):</strong> ${state.profile?.name || 'أستاذ المادة'} | <strong>المؤسسة:</strong> ${state.profile?.schoolName || 'ثانوية التعليم الثانوي'} | <strong>السنة الدراسية:</strong> ${state.profile?.academicYear || '2025/2026'}</p>
        <p><strong>القسم:</strong> ${activeClass?.name || 'جميع الأقسام'} | <strong>عدد الملاحظات:</strong> ${noteSessions.length}</p>
      </div>
      ${noteRows.length > 0 ? noteRows : '<p style="text-align:center;">لا توجد ملاحظات مسجلة حتى الآن.</p>'}
    `;

    exportToDoc(html, `دفتر_الملاحظات_${activeClass?.name || 'القسم'}`);
  };

  return (
    <div className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6" id="session-cahier-view">
      {/* Actions bar — no redundant h2 title */}
      {(classPastSessions.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExportCahierDoc}
            className="px-3.5 py-1.5 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer" title="تصدير دفتر النصوص كاملاً إلى ملف Word (.doc)" >
            <FileDown className="w-3.5 h-3.5 text-white/70" />
            <span>تصدير (.doc)</span>
          </button>
          <button
            onClick={handleExportNotesDoc}
            className="px-3.5 py-1.5 rounded-xl bg-[var(--warning)] hover:bg-amber-700 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer" >
            <Lightbulb className="w-3.5 h-3.5 text-white/70" />
            <span>تصدير دفتر الملاحظات (.doc)</span>
          </button>
          <div className="px-3.5 py-1.5 rounded-xl bg-[var(--primary-soft)] border border-[var(--primary)]/20 text-xs font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--primary)]" />
            <span>{activeClass?.name || 'لم يحدد قسم'}</span>
          </div>
        </div>
      )}

      {savedSuccessMsg && (
        <div className="p-3 bg-[var(--primary-soft)] border border-[var(--primary)]/20 text-[var(--primary)] text-xs rounded-xl flex items-center gap-2 shadow-xs animate-in fade-in duration-200">
          <CheckCircle2 className="w-4 h-4 text-[var(--primary)]" />
          <span className="font-bold">تم توثيق الحصة وتحديث حالة الإنجاز في المنهاج بنجاح.</span>
        </div>
      )}

      {/* Session Entry Form */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-2">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[var(--primary)] shrink-0" />
                <span>بيانات الحصة والوحدة المقررة</span>
              </h3>
              <button
                type="button"
                onClick={handleSaveSession}
                className="inline-flex sm:hidden items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold shadow-xs cursor-pointer transition-all shrink-0"
                title="حفظ سريع للحصة"
              >
                <Save className="w-3.5 h-3.5" />
                <span>حفظ سريع</span>
              </button>
            </div>

            {/* Date, Time & Unit Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">تاريخ الحصة:</label>
                <input
                  type="date" value={sessionDate}
                  onChange={e => handleSessionDateChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-slate-900 focus:ring-1 focus:ring-[var(--primary)]" />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">من الساعة:</label>
                <input
                  type="time" value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-slate-900 focus:ring-1 focus:ring-[var(--primary)]" />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">إلى الساعة:</label>
                <input
                  type="time" value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-slate-900 focus:ring-1 focus:ring-[var(--primary)]" />
              </div>
            </div>

            {/* Lesson / Unit Picker */}
            <div className="space-y-1 text-sm">
              <label className="font-bold text-slate-700 flex items-center justify-between">
                <span>موضوع الدرس / الوحدة التعلمية المقررة:</span>
                {selectedUnitObj && (
                  <span className="text-[var(--primary)] font-semibold">
                    الميدان: {selectedUnitObj.domain} • الحجم: {selectedUnitObj.hourlyVolume} سا
                  </span>
                )}
              </label>
              <select
                value={effectiveSelectedUnitId}
                onChange={e => handleSelectUnit(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-900 focus:ring-1 focus:ring-[var(--primary)] cursor-pointer bg-white" >
                {availableUnits.map(unit => (
                  <option key={unit.id} value={unit.id}>
                    الوحدة {unit.unitNumber}: {unit.title} ({unit.domain})
                  </option>
                ))}
              </select>
            </div>

            {/* Show the latest note for this unit as a writing aid */}
            {previousMemoryForThisUnit && (
              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs space-y-1">
                <div className="font-black text-amber-900 flex items-center gap-1.5">
                  <Lightbulb className="w-4 h-4 text-amber-600" />
                  <span>ملاحظة سابقة لنفس هذا الدرس:</span>
                </div>
                <p className="text-sm leading-7 text-[var(--text-primary)] whitespace-pre-line">
                  {getSessionNotes(previousMemoryForThisUnit)}
                </p>
              </div>
            )}

            {/* Objectives (Static View) */}
            <div className="space-y-1 text-sm">
              <div className="flex items-center justify-between gap-2 flex-wrap pb-0.5">
                <label className="font-bold text-slate-700 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-[var(--primary)]" />
                  <span>الأهداف التعلمية المسطرة للحصة:</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-normal text-[10px] hidden sm:inline">مستخرجة آلياً من قاعدة البيانات</span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden p-3 min-h-[60px]">
                {sessionGoals ? (
                  <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700 font-medium">{sessionGoals}</div>
                ) : (
                  <span className="text-slate-400 italic">اختر وحدة تعليمية لعرض أهدافها...</span>
                )}
              </div>
            </div>

            {/* Quick session record */}
            <div className="space-y-1 text-sm">
              <label className="font-bold text-slate-700 flex items-center justify-between">
                <span>توثيق الحصة وما تم إنجازه:</span>
                <span className="text-slate-400 font-normal text-[10px]">ملاحظة واحدة مختصرة تكفي</span>
              </label>
              <div className="rounded-xl border border-slate-300 overflow-hidden focus-within:ring-1 focus-within:ring-[var(--primary)]">
                <FormattingBar val={accomplishments} setter={setAccomplishments} />
                <textarea
                  rows={4}
                  value={accomplishments}
                  onChange={e => setAccomplishments(e.target.value)}
                  placeholder="اكتب باختصار ما أنجزته في الحصة، أهم المناقشات، والواجب أو التوجيه للحصة القادمة..." className="w-full px-3 py-2 text-sm leading-7 text-slate-900 border-0 focus:outline-none resize-y" />
              </div>
            </div>

            {/* Official journal follow-up field */}
            <div className="space-y-1 text-sm">
              <label className="font-bold text-slate-700">
                التوجيهات والواجبات للحصة القادمة:
              </label>
              <div className="rounded-xl border border-slate-300 overflow-hidden focus-within:ring-1 focus-within:ring-[var(--primary)]">
                <FormattingBar val={nextSteps} setter={setNextSteps} />
                <textarea
                  rows={2}
                  value={nextSteps}
                  onChange={e => setNextSteps(e.target.value)}
                  placeholder="اكتب الواجب أو المعالجة أو التوجيه الذي سيُعرض في الدفتر اليومي..."
                  className="w-full px-3 py-2 text-sm leading-7 text-slate-900 border-0 focus:outline-none resize-y"
                />
              </div>
            </div>

            {/* Unified notebook input */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-xs font-black text-slate-900">
                  <Lightbulb className="w-4 h-4 text-amber-600" />
                  <span>دفتر الملاحظات</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                مساحة واحدة لتسجيل ما حدث في الحصة، وما يحتاج متابعة، وأي توجيه للحصة القادمة.
              </p>

              <div className="space-y-1 text-xs">
                <label className="font-semibold text-[var(--primary)]">ملاحظاتك عن الحصة</label>
                <div className="rounded-xl border border-slate-300 bg-white overflow-hidden focus-within:ring-1 focus-within:ring-[var(--primary)]">
                  <FormattingBar val={notes} setter={setNotes} />
                  <textarea
                    rows={4}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="دوّن ما نجح، الصعوبات، تفاعل التلاميذ، وما تريد تغييره أو متابعته في الحصة القادمة..."
                    className="w-full px-3 py-3 text-sm leading-7 border-0 focus:outline-none text-slate-900 resize-y" />
                </div>
              </div>
            </div>

            {/* Submit button */}
            <div className="pt-2 flex justify-stretch sm:justify-end">
              <button
                onClick={handleSaveSession}
                className="w-full sm:w-auto min-h-11 flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-black shadow-md cursor-pointer transition-all" id="btn-save-session-record" >
                <Save className="w-4 h-4" />
                <span>حفظ الحصة في الدفتر اليومي وتأكيد الإنجاز</span>
              </button>
            </div>
      </div>

      {/* Historical Sessions Log */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-700" />
            <span>سجل الحصص السابقة لقسم {activeClass?.name} ({classPastSessions.length} حصة)</span>
          </h3>
        </div>

        {classPastSessions.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400">
            لم تسجل بعد أي حصة لهذا القسم. استخدم النموذج أعلاه لتدوين أول حصة.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {classPastSessions.map(ses => {
              const unit = availableUnits.find(u => u.id === ses.unitId);

              return (
                <div key={ses.id} className="py-3 flex items-start justify-between gap-4 text-sm">
                  <div className="space-y-1 max-w-2xl">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                        {ses.date}
                      </span>
                      <span className="text-slate-500 font-mono">
                        {ses.startTime} – {ses.endTime}
                      </span>
                      <span className="font-bold text-slate-900">
                        {unit ? unit.title : 'حصة غير محددة'}
                      </span>
                    </div>
                    {ses.accomplishments && (
                      <p className="text-sm leading-7 text-slate-600 whitespace-pre-line">
                        <span className="font-semibold text-slate-700">ما تم إنجازه: </span>
                        {ses.accomplishments}
                      </p>
                    )}
                    {ses.nextSteps && (
                      <p className="text-sm leading-7 text-slate-500 whitespace-pre-line">
                        <span className="font-semibold text-slate-600">التوجيهات: </span>
                        {ses.nextSteps}
                      </p>
                    )}
                    {getSessionNotes(ses) && (
                      <p className="text-sm leading-7 text-amber-800 whitespace-pre-line rounded-lg bg-amber-50 px-2 py-1.5">
                        <span className="font-semibold text-amber-900">دفتر الملاحظات: </span>
                        {getSessionNotes(ses)}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => setDeleteConfirmId(ses.id)}
                    className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer" title="حذف الحصة" >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
          <ConfirmDialog
        isOpen={!!deleteConfirmId}
        title="تأكيد الحذف" message="هل أنت متأكد من حذف هذا السجل من الدفتر اليومي؟" onConfirm={() => { if (deleteConfirmId) handleDeleteSession(deleteConfirmId); }}
        onCancel={() => setDeleteConfirmId(null)}
      />
</div>
  );
};
