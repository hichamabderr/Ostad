'use client';

import React, { useEffect, useState } from 'react';
import { useAppState } from '@/hooks/app-state-context';
import { AppState } from '@/lib/storage';
import { calculateContinuousEvaluation, calculateStudentAverage } from '@/lib/grade-calculator';
import { triggerHapticFeedback } from '@/lib/utils';
import { Student, StudentGrade } from '@/lib/types';
import {
  PEDAGOGICAL_TIERS,
  getScoreTier,
  getDefaultEstimation,
  getDefaultGuidance
} from '@/lib/pedagogical-evaluations';
import {
  GraduationCap,
  Save,
  FileSpreadsheet,
  Download,
  Upload,
  Info,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  HelpCircle,
  X,
  Search,
  Sparkles,
  PenLine,
  ListFilter,
  FileDown
} from 'lucide-react';

/**
 * قائمة منسدلة ذكية للتقديرات تشمل كل الاحتمالات الوزارية مصنفة حسب النقطة
 */
const EstimationDropdown: React.FC<{
  studentId: string;
  value: string;
  avg: number | null;
  onChange: (val: string) => void;
}> = ({ studentId, value, avg, onChange }) => {
  const [isCustom, setIsCustom] = useState(false);
  const currentTier = getScoreTier(avg);
  const tierInfo = PEDAGOGICAL_TIERS[currentTier];

  const ratedTiers = Object.values(PEDAGOGICAL_TIERS).filter(t => t.tier !== 'UNRATED');
  const allKnown = ratedTiers.flatMap(t => t.estimations);
  const isCustomValue = Boolean(value && !allKnown.includes(value));

  if (isCustom) {
    return (
      <div className="flex items-center gap-1 w-full" id={`est-custom-${studentId}`}>
        <input
          type="text" value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="اكتب التقدير مخصصاً..." className="w-full text-xs px-2 py-1 rounded-lg border border-gold bg-amber-50/50 font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-gold shadow-2xs" autoFocus
        />
        <button
          type="button" onClick={() => setIsCustom(false)}
          title="العودة للقائمة المنسدلة" className="p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-100 cursor-pointer rounded shrink-0 transition-colors" >
          <ListFilter className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 w-full" id={`est-select-container-${studentId}`}>
      <select
        value={value}
        onChange={e => {
          if (e.target.value === '__CUSTOM__') {
            setIsCustom(true);
          } else {
            onChange(e.target.value);
          }
        }}
        className="w-full text-xs px-2 py-1.5 rounded-lg border border-slate-300 bg-white font-bold text-slate-800 focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold cursor-pointer shadow-2xs transition-colors" >
        <option value="">-- اختر التقدير --</option>

        {/* الاحتمالات الموصى بها مباشرة حسب نقطة التلميذ */}
        {avg !== null && (
          <optgroup label={`⭐ موصى بها حسب النقطة (${tierInfo.label})`}>
            {tierInfo.estimations.map((est, i) => (
              <option key={`rec-${i}`} value={est}>
                {est}
              </option>
            ))}
          </optgroup>
        )}

        {/* كافة الاحتمالات الأخرى حسب المستويات الوزارية */}
        {ratedTiers.map(t => (
          <optgroup key={t.tier} label={`فئة: ${t.label}`}>
            {t.estimations.map((est, i) => (
              <option key={`${t.tier}-${i}`} value={est}>
                {est}
              </option>
            ))}
          </optgroup>
        ))}

        {isCustomValue && (
          <optgroup label="تقدير مخصص مسجل حالياً">
            <option value={value}>{value}</option>
          </optgroup>
        )}

        <optgroup label="تخصيص">
          <option value="__CUSTOM__">✍️ كتابة تقدير مخصص...</option>
        </optgroup>
      </select>

      <button
        type="button" onClick={() => setIsCustom(true)}
        title="كتابة يدوية مخصصة" className="p-1 text-slate-400 hover:text-amber-700 hover:bg-slate-100 cursor-pointer rounded shrink-0 transition-colors" >
        <PenLine className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

/**
 * قائمة منسدلة ذكية للإرشادات تشمل كل الاحتمالات والتوجيهات البيداغوجية حسب النقطة
 */
const GuidanceDropdown: React.FC<{
  studentId: string;
  value: string;
  avg: number | null;
  onChange: (val: string) => void;
}> = ({ studentId, value, avg, onChange }) => {
  const [isCustom, setIsCustom] = useState(false);
  const currentTier = getScoreTier(avg);
  const tierInfo = PEDAGOGICAL_TIERS[currentTier];

  const ratedTiers = Object.values(PEDAGOGICAL_TIERS).filter(t => t.tier !== 'UNRATED');
  const allKnown = ratedTiers.flatMap(t => t.guidanceList);
  const isCustomValue = Boolean(value && !allKnown.includes(value));

  if (isCustom) {
    return (
      <div className="flex items-center gap-1 w-full" id={`guidance-custom-${studentId}`}>
        <input
          type="text" value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="اكتب الإرشاد البيداغوجي..." className="w-full text-xs px-2.5 py-1 rounded-lg border border-gold bg-amber-50/50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-gold shadow-2xs" autoFocus
        />
        <button
          type="button" onClick={() => setIsCustom(false)}
          title="العودة للقائمة المنسدلة" className="p-1 text-slate-400 hover:text-amber-700 hover:bg-amber-100 cursor-pointer rounded shrink-0 transition-colors" >
          <ListFilter className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 w-full" id={`guidance-select-container-${studentId}`}>
      <select
        value={value}
        onChange={e => {
          if (e.target.value === '__CUSTOM__') {
            setIsCustom(true);
          } else {
            onChange(e.target.value);
          }
        }}
        className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold cursor-pointer shadow-2xs transition-colors" >
        <option value="">-- اختر الإرشاد --</option>

        {/* الإرشادات الموصى بها حسب النقطة */}
        {avg !== null && (
          <optgroup label={`🎯 إرشادات موصى بها حسب النقطة (${tierInfo.label})`}>
            {tierInfo.guidanceList.map((g, i) => (
              <option key={`rec-g-${i}`} value={g}>
                {g}
              </option>
            ))}
          </optgroup>
        )}

        {/* كافة الاحتمالات والتوجيهات البيداغوجية الأخرى */}
        {ratedTiers.map(t => (
          <optgroup key={`g-grp-${t.tier}`} label={`إرشادات فئة: ${t.label}`}>
            {t.guidanceList.map((g, i) => (
              <option key={`${t.tier}-g-${i}`} value={g}>
                {g}
              </option>
            ))}
          </optgroup>
        ))}

        {isCustomValue && (
          <optgroup label="إرشاد مخصص مسجل حالياً">
            <option value={value}>{value}</option>
          </optgroup>
        )}

        <optgroup label="تخصيص">
          <option value="__CUSTOM__">✍️ كتابة إرشاد مخصص...</option>
        </optgroup>
      </select>

      <button
        type="button" onClick={() => setIsCustom(true)}
        title="كتابة يدوية مخصصة" className="p-1 text-slate-400 hover:text-amber-700 hover:bg-slate-100 cursor-pointer rounded shrink-0 transition-colors" >
        <PenLine className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

function buildDraft(
  students: Student[],
  grades: StudentGrade[],
  classId: string,
  trimester: 1 | 2 | 3
) {
  const filtered = students.filter(s => s.classId === classId);
  const draft: {
    [id: string]: {
      continuousEval: string;
      quiz: string;
      exam: string;
      estimation: string;
      guidance: string;
      remarks: string;
    };
  } = {};
  for (const st of filtered) {
    const g = grades.find(x => x.studentId === st.id && x.trimester === trimester);
    draft[st.id] = {
      continuousEval: g?.continuousEval !== null && g?.continuousEval !== undefined ? String(g.continuousEval) : '',
      quiz: g?.quiz !== null && g?.quiz !== undefined ? String(g.quiz) : '',
      exam: g?.exam !== null && g?.exam !== undefined ? String(g.exam) : '',
      estimation: g?.estimation || '',
      guidance: g?.guidance || '',
      remarks: g?.remarks || '' };
  }
  return draft;
}

interface GradesAndEvaluationProps {
}

export const GradesAndEvaluation: React.FC<GradesAndEvaluationProps> = () => {
  const { state, updateState: onUpdateState, updateStateAndWait } = useAppState();
  const [selectedClassId, setSelectedClassId] = useState<string>(
    state.activeClassId || (state.classes[0]?.id || '')
  );
  const [selectedTrimester, setSelectedTrimester] = useState<1 | 2 | 3>(
    state.activeTrimester || 1
  );

  const [showFormulaModal, setShowFormulaModal] = useState(false);
  const [saveToast, setSaveToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'pending'>('saved');
  const [mobileActiveTab, setMobileActiveTab] = useState<'continuousEval' | 'quiz' | 'exam'>('continuousEval');
  const [searchStudent, setSearchStudent] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const isDirtyRef = React.useRef(false);

  const activeClass = state.classes.find(c => c.id === selectedClassId);
  const classStudents = state.students
    .filter(s => s.classId === selectedClassId)
    .sort((a, b) => a.numberInList - b.numberInList);

  // Local editable grades map for smooth typing without lag
  const [gradesDraft, setGradesDraft] = useState(() =>
    buildDraft(
      state.students,
      state.grades,
      state.activeClassId || (state.classes[0]?.id || ''),
      state.activeTrimester || 1
    )
  );

  useEffect(() => {
    if (state.activeClassId && state.activeClassId !== selectedClassId) {
      setSelectedClassId(state.activeClassId);
      isDirtyRef.current = false;
      setGradesDraft(buildDraft(state.students, state.grades, state.activeClassId, selectedTrimester));
    }
  }, [state.activeClassId, selectedClassId, state.students, state.grades, selectedTrimester]);

  const handleSelectClass = (newClassId: string) => {
    if (isDirtyRef.current) {
      void persistDraftGrades();
    }
    setSelectedClassId(newClassId);
    isDirtyRef.current = false;
    onUpdateState(prev => ({ ...prev, activeClassId: newClassId }));
    setGradesDraft(buildDraft(state.students, state.grades, newClassId, selectedTrimester));
  };

  const handleSelectTrimester = (newTri: 1 | 2 | 3) => {
    if (isDirtyRef.current) {
      void persistDraftGrades();
    }
    setSelectedTrimester(newTri);
    isDirtyRef.current = false;
    setGradesDraft(buildDraft(state.students, state.grades, selectedClassId, newTri));
  };

  // Precompute stats per student for continuous evaluation calculation
  const classSessions = state.sessions.filter(s => s.classId === selectedClassId);
  const studentStatsMap: Record<string, {
    absent: number; late: number; excused: number;
    disruptions: number; unwritten: number; poorPart: number; goodPart: number;
  }> = {};

  for (const s of classStudents) {
    studentStatsMap[s.id] = { absent: 0, late: 0, excused: 0, disruptions: 0, unwritten: 0, poorPart: 0, goodPart: 0 };
  }

  for (const session of classSessions) {
    if (session.attendance) {
      for (const [studentId, status] of Object.entries(session.attendance)) {
        if (!studentStatsMap[studentId]) studentStatsMap[studentId] = { absent: 0, late: 0, excused: 0, disruptions: 0, unwritten: 0, poorPart: 0, goodPart: 0 };
        if (status === 'ABSENT') studentStatsMap[studentId].absent++;
        else if (status === 'LATE') studentStatsMap[studentId].late++;
        else if (status === 'EXCUSED') studentStatsMap[studentId].excused++;
      }
    }
    if (session.disruptions) {
      for (const studentId of session.disruptions) {
        if (studentStatsMap[studentId]) studentStatsMap[studentId].disruptions++;
      }
    }
    if (session.unwrittenLessons) {
      for (const studentId of session.unwrittenLessons) {
        if (studentStatsMap[studentId]) studentStatsMap[studentId].unwritten++;
      }
    }
    if (session.poorParticipation) {
      for (const studentId of session.poorParticipation) {
        if (studentStatsMap[studentId]) studentStatsMap[studentId].poorPart++;
      }
    }
    if (session.goodParticipation) {
      for (const studentId of session.goodParticipation) {
        if (studentStatsMap[studentId]) studentStatsMap[studentId].goodPart++;
      }
    }
  }

  const calcAutoContinuousEval = (studentId: string): number => {
    const stats = studentStatsMap[studentId];
    if (!stats) return 20;

    const rules = state.calendarSettings?.evaluationRules;
    const behaviorScore = Math.max(
      0,
      (rules?.behaviorMax ?? 5) - stats.disruptions * (rules?.disruptionDeduction ?? 0.5)
    );
    const attendanceScore = Math.max(
      0,
      (rules?.attendanceMax ?? 5) -
        stats.absent * (rules?.unexcusedAbsenceDeduction ?? 1) -
        stats.late * (rules?.lateDeduction ?? 0.5)
    );
    const notebookScore = Math.max(
      0,
      (rules?.notebookMax ?? 5) - stats.unwritten * (rules?.unwrittenLessonDeduction ?? 0.5)
    );
    const participationScore = Math.max(
      0,
      (rules?.participationMax ?? 5) -
        stats.poorPart * (rules?.lackOfParticipationDeduction ?? 0) +
        stats.goodPart * (rules?.participationBonus ?? 0.5)
    );

    return calculateContinuousEvaluation(
      Math.min(rules?.behaviorMax ?? 5, behaviorScore),
      Math.min(rules?.attendanceMax ?? 5, attendanceScore),
      Math.min(rules?.notebookMax ?? 5, notebookScore),
      Math.min(rules?.participationMax ?? 5, participationScore)
    );
  };

  const handleAutoFillContinuousEval = () => {
    let count = 0;
    isDirtyRef.current = true;
    setGradesDraft(prev => {
      const next = { ...prev };
      for (const st of classStudents) {
        const d = next[st.id] || { continuousEval: '', quiz: '', exam: '', estimation: '', guidance: '', remarks: '' };
        if (d.continuousEval === '') {
          next[st.id] = { ...d, continuousEval: String(calcAutoContinuousEval(st.id)) };
          count++;
        }
      }
      return next;
    });
    setToastMessage(`تم حساب التقويم آلياً لـ (${count}) تلميذ بدون تغيير النقاط المدخلة يدوياً.`);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 3500);
  };

  const handleUseAutoContinuousEval = (studentId: string) => {
    const autoScore = calcAutoContinuousEval(studentId);
    isDirtyRef.current = true;
    setGradesDraft(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || { continuousEval: '', quiz: '', exam: '', estimation: '', guidance: '', remarks: '' }),
        continuousEval: String(autoScore)
      }
    }));
    setToastMessage(`تم وضع النقطة الآلية ${autoScore} في خانة التقويم المستمر. يمكنك تعديلها يدوياً.`);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 3000);
  };

  const handleGradeChange = (
    studentId: string,
    field: 'continuousEval' | 'quiz' | 'exam',
    value: string
  ) => {
    // allow empty, or number between 0 and 20
    if (value !== '' && (isNaN(Number(value)) || Number(value) < 0 || Number(value) > 20)) {
      setToastMessage('تنبيه: يجب أن تكون العلامة محصورة بين 0 و 20.');
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 3500);
      return;
    }
    isDirtyRef.current = true;
    setGradesDraft(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || { continuousEval: '', quiz: '', exam: '', estimation: '', guidance: '', remarks: '' }),
        [field]: value
      }
    }));
  };

  const handleTextFieldChange = (
    studentId: string,
    field: 'estimation' | 'guidance' | 'remarks',
    value: string
  ) => {
    isDirtyRef.current = true;
    setGradesDraft(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || { continuousEval: '', quiz: '', exam: '', estimation: '', guidance: '', remarks: '' }),
        [field]: value
      }
    }));
  };

  // تطبيق التقديرات والإرشادات آلياً لجميع التلاميذ حسب نقاطهم ومعدلاتهم المحسوبة
  const handleAutoFillPedagogicalFields = () => {
    let count = 0;
    isDirtyRef.current = true;
    setGradesDraft(prev => {
      const next = { ...prev };
      for (const st of classStudents) {
        const d = next[st.id] || { continuousEval: '', quiz: '', exam: '', estimation: '', guidance: '', remarks: '' };
        const ce = d.continuousEval !== '' ? Number(d.continuousEval) : null;
        const q = d.quiz !== '' ? Number(d.quiz) : null;
        const ex = d.exam !== '' ? Number(d.exam) : null;
        const avg = calculateStudentAverage(ce, q, ex);
        if (avg !== null) {
          next[st.id] = {
            ...d,
            estimation: getDefaultEstimation(avg),
            guidance: getDefaultGuidance(avg)
          };
          count++;
        }
      }
      return next;
    });
    setToastMessage(`تم تطبيق التقديرات والإرشادات آلياً لـ (${count}) تلميذ حسب نقاطهم ومعدلاتهم بنجاح!`);
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 3500);
  };

  const persistDraftGrades = async () => {
    await updateStateAndWait(prev => {
      const updatedGradesList: StudentGrade[] = [...prev.grades];

      for (const student of classStudents) {
        const draft = gradesDraft[student.id] || { continuousEval: '', quiz: '', exam: '', estimation: '', guidance: '', remarks: '' };
        const ceVal = draft.continuousEval !== '' ? Number(draft.continuousEval) : null;
        const qVal = draft.quiz !== '' ? Number(draft.quiz) : null;
        const exVal = draft.exam !== '' ? Number(draft.exam) : null;

        const calcAvg = calculateStudentAverage(ceVal, qVal, exVal);
        const estVal = draft.estimation || (calcAvg !== null ? getDefaultEstimation(calcAvg) : '');
        const guidanceVal = draft.guidance || (calcAvg !== null ? getDefaultGuidance(calcAvg) : '');

        const existingIndex = updatedGradesList.findIndex(
          g => g.studentId === student.id && g.trimester === selectedTrimester
        );

        const existingGrade = existingIndex >= 0 ? updatedGradesList[existingIndex] : undefined;
        const gradeObj: StudentGrade = {
          ...existingGrade,
          id: existingGrade?.id || `gr-${student.id}-t${selectedTrimester}`,
          studentId: student.id,
          classId: selectedClassId,
          trimester: selectedTrimester,
          continuousEval: ceVal,
          quiz: qVal,
          exam: exVal,
          calculatedAverage: calcAvg,
          estimation: estVal,
          guidance: guidanceVal
        };

        if (existingIndex >= 0) {
          updatedGradesList[existingIndex] = gradeObj;
        } else {
          updatedGradesList.push(gradeObj);
        }
      }

      return {
        ...prev,
        grades: updatedGradesList
      };
    });
  };

  const persistDraftGradesRef = React.useRef(persistDraftGrades);
  persistDraftGradesRef.current = persistDraftGrades;

  useEffect(() => {
    if (!isDirtyRef.current) return;
    setSaveStatus('pending');
    const timer = window.setTimeout(() => {
      setSaveStatus('saving');
      void persistDraftGradesRef.current()
        .then(() => {
          isDirtyRef.current = false;
          setSaveStatus('saved');
        })
        .catch((error: unknown) => {
          console.error('Grades sync failed:', error);
          setSaveStatus('pending');
          setToastMessage('تعذر حفظ النقاط في السحابة.');
          setSaveToast(true);
        });
    }, 900);
    return () => {
      window.clearTimeout(timer);
    };
  }, [gradesDraft]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtyRef.current) {
        void persistDraftGradesRef.current();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (isDirtyRef.current) {
        void persistDraftGradesRef.current();
      }
    };
  }, []);

  const handleSaveAllGrades = async () => {
    triggerHapticFeedback();
    setSaveStatus('saving');
    try {
      await persistDraftGrades();
      setSaveStatus('saved');
      const incompleteCount = classStudents.filter(student => {
        const draft = gradesDraft[student.id];
        return !draft || draft.continuousEval === '' || draft.quiz === '' || draft.exam === '';
      }).length;
      setToastMessage(
        incompleteCount > 0
          ? `تم حفظ النقاط. أُجّل حساب المعدل لـ ${incompleteCount} تلميذ حتى تكتمل نقاط التقويم والفرض والاختبار.`
          : `تم حفظ وحساب كافة علامات ومعدلات الفصل ${selectedTrimester} بنجاح!`
      );
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 3500);
    } catch (error: unknown) {
      console.error('Grades sync failed:', error);
      setSaveStatus('pending');
      setToastMessage('تعذر حفظ النقاط في السحابة.');
      setSaveToast(true);
    }
  };

  // Export marks sheet to Excel
  const handleDigitizationUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeClass) return;

    setIsExporting(true);
    try {
      // Save current grades in state as well
      handleSaveAllGrades();

      // Collect all grades for this trimester, ensuring current draft edits are merged
      const trimesterGrades = [...state.grades.filter(g => g.trimester === selectedTrimester)];
      
      Object.entries(gradesDraft).forEach(([studentId, draft]) => {
        const ce = draft.continuousEval !== '' ? Number(draft.continuousEval) : null;
        const q = draft.quiz !== '' ? Number(draft.quiz) : null;
        const ex = draft.exam !== '' ? Number(draft.exam) : null;
        const calculatedAverage = calculateStudentAverage(ce, q, ex);
        const est = draft.estimation;
        const gui = draft.guidance;

        const existingIdx = trimesterGrades.findIndex(
          g => g.studentId === studentId && g.classId === activeClass.id && g.trimester === selectedTrimester
        );

        if (existingIdx !== -1) {
          trimesterGrades[existingIdx] = {
            ...trimesterGrades[existingIdx],
            continuousEval: ce,
            quiz: q,
            exam: ex,
            calculatedAverage,
            estimation: est,
            guidance: gui,
          };
        } else {
          trimesterGrades.push({
            id: `grd-${studentId}-${selectedTrimester}`,
            studentId,
            classId: activeClass.id,
            trimester: selectedTrimester,
            continuousEval: ce,
            quiz: q,
            exam: ex,
            calculatedAverage,
            estimation: est,
            guidance: gui,
          });
        }
      });

      // Pass the official empty file, all students, and the grades
      const { injectGradesIntoFile } = await import('@/lib/excel-sync');
      const injectionResult = await injectGradesIntoFile(file, state.students, trimesterGrades);
      if (injectionResult.matchedStudents === 0) {
        throw new Error('لم تتم مطابقة أي تلميذ داخل الملف الرسمي. لم يتم تنزيل ملف؛ تحقق من القسم أو رقم التعريف والاسم.');
      }
      
      // Download the modified ministry workbook without changing its filename.
      const url = URL.createObjectURL(injectionResult.blob);
      const link = document.createElement('a');
      link.href = url;
      // Keep the ministry workbook filename unchanged for upload validation.
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      setToastMessage(
        `تم حقن ${injectionResult.gradesWritten} قيمة في ملف الرقمنة لـ ${injectionResult.matchedStudents} تلاميذ مع الحفاظ على القالب الأصلي.`
      );
      setSaveToast(true);
      setTimeout(() => setSaveToast(false), 4000);
    } catch (err: any) {
      console.error(err);
      import('@/components/Toast').then(({ showToast }) => {
        showToast(err.message || 'حدث خطأ أثناء حقن البيانات. تأكد من أنه ملف الرقمنة الرسمي الصحيح.', 'error');
      });
    } finally {
      setIsExporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExportExcel = async () => {
    if (!activeClass) return;

    const rows = classStudents.map((st, idx) => {
      const draft = gradesDraft[st.id] || { continuousEval: '', quiz: '', exam: '', estimation: '', guidance: '', remarks: '' };
      const ce = draft.continuousEval !== '' ? Number(draft.continuousEval) : '';
      const q = draft.quiz !== '' ? Number(draft.quiz) : '';
      const ex = draft.exam !== '' ? Number(draft.exam) : '';
      const avg = calculateStudentAverage(
        ce !== '' ? ce : null,
        q !== '' ? q : null,
        ex !== '' ? ex : null
      );

      const [lastName, ...firstNameParts] = st.fullName.trim().split(/\s+/);
      return [
        st.registrationNumber || st.regNumber || '',
        lastName || '',
        firstNameParts.join(' '),
        st.birthDate || '',
        ce,
        q,
        ex,
        draft.estimation || (avg !== null ? getDefaultEstimation(avg) : ''),
        draft.guidance || (avg !== null ? getDefaultGuidance(avg) : '')
      ];
    });

    const { utils, writeFile } = await import('xlsx');
    const ws = utils.aoa_to_sheet([
      ['الجمهورية الجزائرية الديمقراطية الشعبية'],
      ['وزارة التربية الوطنية'],
      [`كشف نقاط مادة العلوم الإسلامية - ${activeClass.name} - الفصل ${selectedTrimester}`],
      ['رقم التعريف', 'اللقب', 'الاسم', 'تاريخ الميلاد', 'التقييم المستمر /20', 'معدل الفروض /20', 'الاختبار /20', 'التقديرات', 'الإرشادات'],
      ...rows
    ]);
    ws['!dir'] = 'rtl';
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 8 } }
    ];
    ws['!cols'] = [
      { wch: 21 }, { wch: 18 }, { wch: 22 }, { wch: 14 },
      { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 34 }
    ];
    for (const cellRef of ['A1', 'A2', 'A3']) {
      if (ws[cellRef]) ws[cellRef].s = { font: { bold: true, sz: cellRef === 'A3' ? 14 : 11 }, alignment: { horizontal: 'right' } };
    }
    for (let column = 0; column < 9; column++) {
      const header = utils.encode_cell({ r: 3, c: column });
      if (ws[header]) ws[header].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '2E7D9B' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
    }
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, `الرقمنة_فصل_${selectedTrimester}`);
    writeFile(wb, `كشف_علامات_${activeClass.name.replace(/\s+/g, '_')}_فصل${selectedTrimester}.xlsx`);
  };

  const gradeSummary = classStudents.reduce((summary, student) => {
    const draft = gradesDraft[student.id];
    const ce = draft?.continuousEval !== '' && draft?.continuousEval !== undefined ? Number(draft.continuousEval) : null;
    const quiz = draft?.quiz !== '' && draft?.quiz !== undefined ? Number(draft.quiz) : null;
    const exam = draft?.exam !== '' && draft?.exam !== undefined ? Number(draft.exam) : null;
    const average = calculateStudentAverage(ce, quiz, exam);
    if (average !== null) {
      summary.completed++;
      summary.averageTotal += average;
      if (average < 10) summary.belowTen++;
    } else {
      summary.incomplete++;
    }
    return summary;
  }, { completed: 0, incomplete: 0, belowTen: 0, averageTotal: 0 });
  const overallAverage = gradeSummary.completed > 0
    ? (gradeSummary.averageTotal / gradeSummary.completed).toFixed(2)
    : '-';

  return (
    <div className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6" id="grades-evaluation-view">
      {/* Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 w-full lg:w-auto">
          <input
            type="file" ref={fileInputRef}
            accept=".xlsx, .xls" onChange={handleDigitizationUpload}
            className="hidden" />

          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
            <button
              onClick={() => setShowFormulaModal(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer transition-colors" >
              <HelpCircle className="w-4 h-4 text-slate-500 shrink-0" />
              <span>كيف يُحسب؟</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isExporting}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors" title="حقن النقاط في ملف الرقمنة (Excel) المفرغ" >
              <Download className={`w-4 h-4 shrink-0 ${isExporting ? 'animate-bounce' : ''}`} />
              <span>حقن الرقمنة</span>
            </button>

            <button
              onClick={handleExportExcel}
              className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold shadow-xs cursor-pointer transition-colors" title="استخراج كشف النقاط كملف Excel" id="btn-export-grades-sheet" >
              <FileSpreadsheet className="w-4 h-4 text-[var(--primary)] shrink-0" />
              <span>استخراج كشف النقاط</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2">
            <button
              onClick={handleAutoFillContinuousEval}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)] text-[var(--text-primary)] border border-[var(--primary)] text-xs font-bold cursor-pointer transition-colors shadow-2xs" title="حساب التقويم المستمر آلياً بناءً على الغيابات والسلوك المسجل في دفتر النصوص" >
              <Sparkles className="w-4 h-4 text-[var(--primary)] shrink-0" />
              <span>حساب التقويم آلياً</span>
            </button>

            <button
              onClick={handleAutoFillPedagogicalFields}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold cursor-pointer transition-colors shadow-2xs" title="ملء التقديرات والإرشادات آلياً لجميع تلاميذ القسم حسب نقاطهم ومعدلاتهم" >
              <Sparkles className="w-4 h-4 text-gold shrink-0" />
              <span>تطبيق التقديرات آلياً</span>
            </button>

            <button
              onClick={handleSaveAllGrades}
              className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-gold hover:bg-gold text-white text-xs font-bold shadow-xs cursor-pointer transition-colors" id="btn-save-all-grades" >
              <Save className="w-4 h-4 shrink-0" />
              <span>حفظ كل العلامات</span>
            </button>
            <span
              className={`text-[11px] font-bold ${
                saveStatus === 'saved' ? 'text-[var(--primary)]' : saveStatus === 'saving' ? 'text-amber-700' : 'text-slate-500'
              }`}
              aria-live="polite"
            >
              {saveStatus === 'saved' ? 'محفوظ تلقائياً' : saveStatus === 'saving' ? 'جارٍ الحفظ...' : 'تغييرات تنتظر الحفظ'}
            </span>
          </div>
        </div>
      </div>

      {saveToast && (
        <div
          role="alert"
          className={`p-3.5 rounded-xl font-bold text-xs flex items-center justify-between gap-3 shadow-md transition-all ${
            toastMessage.includes('تعذر') || toastMessage.includes('خطأ')
              ? 'bg-rose-600 text-white'
              : 'bg-[var(--primary)] text-white'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {toastMessage.includes('تعذر') || toastMessage.includes('خطأ') ? (
              <AlertCircle className="w-5 h-5 shrink-0 text-white" />
            ) : (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-white" />
            )}
            <span className="truncate">{toastMessage || `تم حفظ وحساب كافة علامات ومعدلات الفصل ${selectedTrimester} بنجاح!`}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(toastMessage.includes('تعذر') || toastMessage.includes('خطأ')) && (
              <button
                type="button"
                onClick={handleSaveAllGrades}
                className="px-2.5 py-1 rounded-lg bg-white text-rose-700 hover:bg-rose-50 text-[11px] font-black transition-colors cursor-pointer"
              >
                إعادة المحاولة
              </button>
            )}
            <button
              type="button"
              onClick={() => setSaveToast(false)}
              className="p-1 rounded-lg hover:bg-white/20 text-white transition-colors cursor-pointer"
              aria-label="إغلاق التنبيه"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="ملخص دفتر النقاط">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <div className="text-[11px] font-bold text-slate-500">مكتمل</div>
          <div className="mt-1 text-lg font-black text-[var(--primary)]">{gradeSummary.completed}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <div className="text-[11px] font-bold text-slate-500">ناقص</div>
          <div className="mt-1 text-lg font-black text-amber-700">{gradeSummary.incomplete}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <div className="text-[11px] font-bold text-slate-500">المتوسط العام</div>
          <div className="mt-1 text-lg font-black text-slate-900">{overallAverage}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <div className="text-[11px] font-bold text-slate-500">أقل من 10</div>
          <div className="mt-1 text-lg font-black text-rose-700">{gradeSummary.belowTen}</div>
        </div>
      </div>

      {/* Class & Trimester Filter Ribbon */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row gap-4 sm:justify-between items-start sm:items-center w-full sm:w-auto">
          <div className="space-y-0.5 w-full sm:w-auto">
            <span className="text-[11px] font-bold text-slate-500 block">اختر القسم:</span>
            <select
              value={selectedClassId}
              onChange={e => handleSelectClass(e.target.value)}
              className="w-full sm:w-auto bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 outline-none cursor-pointer" >
              {state.classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.stream})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-0.5 w-full sm:w-auto">
            <span className="text-[11px] font-bold text-slate-500 block">الفترة الدراسية:</span>
            <div className="flex items-center bg-slate-50 p-0.5 rounded-lg border border-slate-300 w-full sm:w-auto">
              {([1, 2, 3] as const).map(tri => (
                <button
                  key={tri}
                  onClick={() => handleSelectTrimester(tri)}
                  className={`flex-1 sm:flex-initial px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer text-center ${
                    selectedTrimester === tri
                      ? 'bg-gold text-white shadow-xs' : 'text-slate-600 hover:text-slate-900' }`}
                >
                  الفصل {tri}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-3 text-xs text-slate-500 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
          <span>تعداد القسم: <strong className="text-slate-900">{classStudents.length} تلميذ</strong></span>
        </div>
      </div>

      {/* Mobile Column Quick-Filter & Search Ribbon */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <input
            type="text" value={searchStudent}
            onChange={e => setSearchStudent(e.target.value)}
            placeholder="بحث عن تلميذ لتنقيطه..." className="w-full pl-3 pr-9 py-2 border border-slate-200 rounded-xl bg-white text-xs focus:outline-none focus:ring-2 focus:ring-gold" />
        </div>

        {/* Mobile Segmented Control */}
        <div className="md:hidden flex items-center bg-slate-100/80 p-1 rounded-xl border border-slate-200 text-xs w-full mt-3 sm:mt-0">
          <button
            type="button" onClick={() => setMobileActiveTab('continuousEval')}
            className={`flex-1 py-2 px-2 rounded-lg font-bold text-[11px] transition-all cursor-pointer text-center ${
              mobileActiveTab === 'continuousEval' ? 'bg-white text-[var(--primary)] shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-700' }`}
          >
            التقويم
          </button>
          <button
            type="button" onClick={() => setMobileActiveTab('quiz')}
            className={`flex-1 py-2 px-2 rounded-lg font-bold text-[11px] transition-all cursor-pointer text-center ${
              mobileActiveTab === 'quiz' ? 'bg-white text-[var(--primary)] shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-700' }`}
          >
            الفرض
          </button>
          <button
            type="button" onClick={() => setMobileActiveTab('exam')}
            className={`flex-1 py-2 px-2 rounded-lg font-bold text-[11px] transition-all cursor-pointer text-center ${
              mobileActiveTab === 'exam' ? 'bg-white text-[var(--primary)] shadow-xs border border-slate-200' : 'text-slate-500 hover:text-slate-700' }`}
          >
            الاختبار
          </button>
        </div>
      </div>

      {/* Grades Container */}
      <div className="space-y-3">
        {classStudents.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 text-center py-12 text-slate-400 text-xs shadow-xs">
            لا يوجد تلاميذ مسجلين في هذا القسم. يرجى إضافتهم من تبويب «الأقسام والتوقيت».
          </div>
        ) : (
          <>
            {/* 1. Mobile-First Card View (Screens < 768px): Compact Rows */}
            <div className="block md:hidden space-y-2">
              {classStudents
                .filter(s => s.fullName.toLowerCase().includes(searchStudent.toLowerCase()))
                .map(student => {
                  const draft = gradesDraft[student.id] || { continuousEval: '', quiz: '', exam: '', estimation: '', guidance: '', remarks: '' };
                  const ce = draft.continuousEval !== '' ? Number(draft.continuousEval) : null;
                  const q = draft.quiz !== '' ? Number(draft.quiz) : null;
                  const ex = draft.exam !== '' ? Number(draft.exam) : null;
                  const avg = calculateStudentAverage(ce, q, ex);

                  return (
                    <div
                      key={student.id}
                      className="flex flex-col p-3 bg-white rounded-xl border border-slate-200 shadow-xs gap-3" >
                      {/* Left side: Avatar (#) and Student Name */}
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-mono font-bold text-xs flex items-center justify-center shrink-0 border border-slate-200">
                          {student.numberInList}
                        </span>
                        <div className="min-w-0">
                          <h4 className="font-bold text-sm text-[var(--text-primary)] whitespace-normal break-words leading-tight">
                            {student.fullName}
                          </h4>
                          {student.isRepeater && (
                            <span className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold mt-1">
                              معيد
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 w-full">
                        <span className="text-[11px] font-bold text-slate-500 flex-1">
                          {mobileActiveTab === 'continuousEval' ? 'التقويم المستمر' : mobileActiveTab === 'quiz' ? 'الفرض المحروس' : 'الاختبار الفصلي'}
                        </span>
                        <input
                          type="number" step="0.25" min="0" max="20" placeholder="-" value={draft[mobileActiveTab]}
                          onChange={e => handleGradeChange(student.id, mobileActiveTab, e.target.value)}
                          aria-label={`${mobileActiveTab === 'continuousEval' ? 'التقويم المستمر' : mobileActiveTab === 'quiz' ? 'الفرض المحروس' : 'الاختبار الفصلي'} - ${student.fullName}`}
                          className="w-24 text-center px-2 rounded-lg border border-slate-300 bg-slate-50 font-mono font-bold text-sm text-slate-900 focus:ring-2 focus:ring-gold focus:outline-none focus:bg-white transition-colors min-h-[44px]" />
                      </div>
                      {mobileActiveTab === 'continuousEval' && (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--primary)]/20 bg-[var(--primary-soft)] px-3 py-2">
                          <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
                            المقترح آلياً: <strong className="font-mono text-[var(--primary)]">{calcAutoContinuousEval(student.id).toFixed(2)}</strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUseAutoContinuousEval(student.id)}
                            className="min-h-8 rounded-md border border-[var(--primary)]/30 bg-white px-2 text-[10px] font-bold text-[var(--primary)] hover:bg-[var(--primary-soft)]"
                          >
                            استخدام المقترح
                          </button>
                        </div>
                      )}

                      {avg !== null && (
                        <div className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                          <span className="text-[11px] font-bold text-amber-800">المعدل الفصلي</span>
                          <span className="font-mono text-sm font-bold text-amber-900">{avg.toFixed(2)}</span>
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-2 w-full border-t border-slate-100 pt-3">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">التقديرات</label>
                          <EstimationDropdown studentId={student.id} value={draft.estimation} avg={avg} onChange={val => handleTextFieldChange(student.id, 'estimation', val)} />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">الإرشادات</label>
                          <GuidanceDropdown studentId={student.id} value={draft.guidance} avg={avg} onChange={val => handleTextFieldChange(student.id, 'guidance', val)} />
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* 2. Desktop Table View (Screens >= 768px) */}
            <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-100 text-slate-800 border-b border-slate-200 font-bold">
                    <tr>
                      <th className="py-3 px-3 w-10 text-center">#</th>
                      <th className="py-3 px-4 min-w-[160px]">اسم ولقب التلميذ</th>
                      <th className="py-3 px-2 w-28 text-center">
                        التقويم المستمر
                        <span className="block text-[10px] font-normal text-slate-500">(على 20)</span>
                      </th>
                      <th className="py-3 px-2 w-28 text-center">
                        الفرض المحروس
                        <span className="block text-[10px] font-normal text-slate-500">(على 20)</span>
                      </th>
                      <th className="py-3 px-2 w-28 text-center">
                        الاختبار الفصلي
                        <span className="block text-[10px] font-normal text-slate-500">(على 20 × 2)</span>
                      </th>
                      <th className="py-3 px-3 w-28 text-center bg-amber-50/70 border-x border-amber-200">
                        المعدل الفصلي
                        <span className="block text-[10px] font-normal text-amber-700">(حساب آلي)</span>
                      </th>
                      <th className="py-3 px-3 min-w-[175px]">التقديرات</th>
                      <th className="py-3 px-4 min-w-[200px]">الإرشادات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {classStudents
                      .filter(s => s.fullName.toLowerCase().includes(searchStudent.toLowerCase()))
                      .map(student => {
                        const draft = gradesDraft[student.id] || { continuousEval: '', quiz: '', exam: '', estimation: '', guidance: '', remarks: '' };
                        const ce = draft.continuousEval !== '' ? Number(draft.continuousEval) : null;
                        const q = draft.quiz !== '' ? Number(draft.quiz) : null;
                        const ex = draft.exam !== '' ? Number(draft.exam) : null;
                        const avg = calculateStudentAverage(ce, q, ex);

                        return (
                          <tr key={student.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-500">
                              {student.numberInList}
                            </td>
                            <td className="py-2.5 px-4 font-bold text-slate-900">
                              {student.fullName}
                            </td>

                            {/* Continuous Evaluation (0-20) */}
                            <td className="py-2 px-2 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <input
                                  type="number" step="0.25" min="0" max="20" placeholder="-" value={draft.continuousEval}
                                  onChange={e => handleGradeChange(student.id, 'continuousEval', e.target.value)}
                                  aria-label={`التقويم المستمر - ${student.fullName}`}
                                  className="w-18 text-center px-1 py-1 rounded-md border border-slate-300 font-mono font-bold text-slate-900 focus:outline-amber-600 focus:border-gold" />
                                <div className="flex items-center gap-1 text-[10px] text-[var(--primary)]" title="النقطة المقترحة من سجل الحضور والمتابعة">
                                  <span className="font-mono">{calcAutoContinuousEval(student.id).toFixed(2)}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleUseAutoContinuousEval(student.id)}
                                    className="rounded border border-[var(--primary)]/30 bg-[var(--primary-soft)] px-1.5 py-0.5 font-bold hover:opacity-80"
                                  >
                                    استخدام
                                  </button>
                                </div>
                              </div>
                            </td>

                            {/* Quiz (0-20) */}
                            <td className="py-2 px-2 text-center">
                              <input
                                type="number" step="0.25" min="0" max="20" placeholder="-" value={draft.quiz}
                                onChange={e => handleGradeChange(student.id, 'quiz', e.target.value)}
                                aria-label={`الفرض المحروس - ${student.fullName}`}
                                className="w-18 text-center px-1 py-1 rounded-md border border-slate-300 font-mono font-bold text-slate-900 focus:outline-amber-600 focus:border-gold" />
                            </td>

                            {/* Exam (0-20) */}
                            <td className="py-2 px-2 text-center">
                              <input
                                type="number" step="0.25" min="0" max="20" placeholder="-" value={draft.exam}
                                onChange={e => handleGradeChange(student.id, 'exam', e.target.value)}
                                aria-label={`الاختبار الفصلي - ${student.fullName}`}
                                className="w-18 text-center px-1 py-1 rounded-md border border-slate-300 font-mono font-bold text-slate-900 focus:outline-amber-600 focus:border-gold" />
                            </td>

                            <td className="py-2.5 px-3 text-center bg-amber-50/50 border-x border-amber-200">
                              <span className="font-mono text-sm font-bold text-amber-900">
                                {avg !== null ? avg.toFixed(2) : '-'}
                              </span>
                            </td>

                            {/* Estimation (التقديرات) */}
                            <td className="py-2 px-3">
                              <EstimationDropdown
                                studentId={student.id}
                                value={draft.estimation}
                                avg={avg}
                                onChange={val => handleTextFieldChange(student.id, 'estimation', val)}
                              />
                            </td>

                            {/* Guidelines & Advice (الإرشادات) */}
                            <td className="py-2 px-4">
                              <GuidanceDropdown
                                studentId={student.id}
                                value={draft.guidance}
                                avg={avg}
                                onChange={val => handleTextFieldChange(student.id, 'guidance', val)}
                              />
                            </td>

                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Explanatory Formula Modal */}
      {showFormulaModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                صيغة المعدل
              </h3>
              <button
                onClick={() => setShowFormulaModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center space-y-2">
                <div className="text-[11px] font-bold text-amber-900">الصيغة الوزارية الرسمية:</div>
                <div className="font-mono text-sm font-bold text-amber-950 dir-ltr">
                  المعدل = [ التقويم المستمر + الفرض + (الاختبار × 2) ] ÷ 4
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="font-bold text-slate-900 block">شرح العناصر:</span>
                <ul className="list-disc list-inside space-y-1 text-slate-600">
                  <li><strong>التقويم المستمر (على 20):</strong> يشمل انضباط التلميذ، كراس المادة، المشاركة الصفية، والواجبات المنزلية.</li>
                  <li><strong>الفرض المحروس (على 20):</strong> فرض واحد رسمي خلال الفصل مدته ساعة كاملة.</li>
                  <li><strong>الاختبار الفصلي (على 20):</strong> اختبار موحد يضاعف بمعامل 2 طبقاً للقرارات الوزارية المنظمة للتقويم في الطور الثانوي.</li>
                  <li><strong>معامل المادة:</strong> ثابت (2) في كافة السنوات والشعب (علمي، رياضي، تقني رياضي، تسيير واقتصاد، آداب وفلسفة، لغات أجنبية).</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowFormulaModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold cursor-pointer" >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
