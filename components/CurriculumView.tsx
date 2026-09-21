'use client';

import { ConfirmDialog } from './ConfirmDialog';
import React, { useState } from 'react';
import { AppState } from '@/lib/storage';
import { OFFICIAL_CURRICULUM, OFFICIAL_LEVELS, getMergedCurriculumUnits, loadAllCurriculum } from '@/lib/curriculum-data';
import { useEffect } from 'react';
import { CurriculumUnit, GradeLevel, LessonStatus } from '@/lib/types';
import { v4 as uuidv4 } from 'uuid';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Edit,
  Plus,
  Trash2,
  Sparkles,
  AlertCircle,
  Filter,
  Search,
  Save,
  X,
  ChevronDown,
  ChevronUp,
  FileText,
  FileDown
} from 'lucide-react';

interface CurriculumViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  onPrepareUnit: (unit: CurriculumUnit, tab?: 'card' | 'pdf' | 'bank') => void;
}

export const CurriculumView: React.FC<CurriculumViewProps> = ({
  state,
  onUpdateState,
  onPrepareUnit
}) => {
  const [, setLoaded] = useState(false);
  useEffect(() => {
    loadAllCurriculum().then(() => setLoaded(true));
  }, []);
  const activeClass = state.classes.find(c => c.id === state.activeClassId);
  const [selectedLevel, setSelectedLevel] = useState<GradeLevel>(
    activeClass?.level || '3AS' );
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedUnitId, setExpandedUnitId] = useState<string | null>(null);

  // Edit / Add Unit Modal State
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Partial<CurriculumUnit> | null>(null);

  // Combine official curriculum with custom units cleanly deduplicated by ID
  const allUnits = getMergedCurriculumUnits(state.customUnits);

  // Filter by selected level & search query
  const filteredUnits = allUnits.filter(unit => {
    if (unit.level !== selectedLevel) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      unit.title.toLowerCase().includes(q) ||
      unit.domain.toLowerCase().includes(q) ||
      (unit.targetedCompetence && unit.targetedCompetence.toLowerCase().includes(q)) ||
      (unit.learningObjectives && unit.learningObjectives.some(obj => obj.toLowerCase().includes(q)))
    );
  });

  // Helper to extract clean competence number (أرقام الكفاءات من دون عنوان)
  const getCompetenceNumber = (unit: CurriculumUnit, idx: number): string => {
    if (unit.targetedCompetence) {
      const match = unit.targetedCompetence.match(/([0-9]+)/);
      if (match) return `ك ${match[1]}`;
    }
    return `ك ${((idx % 5) + 1)}`;
  };

  // State for inline handwritten note insertion
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [activeNoteText, setActiveNoteText] = useState<string>('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const getUnitNote = (unitId: string): string => {
    const prog = state.lessonProgress.find(p => p.unitId === unitId);
    return prog?.notes || '';
  };

  const handleSaveUnitNote = (unitId: string) => {
    onUpdateState(prev => {
      const existingIdx = prev.lessonProgress.findIndex(p => p.unitId === unitId);
      let updated = [...prev.lessonProgress];
      if (existingIdx >= 0) {
        updated[existingIdx] = {
          ...updated[existingIdx],
          notes: activeNoteText
        };
      } else {
        updated.push({
          id: `prog-note-${unitId}-${uuidv4()}`,
          classId: prev.activeClassId || (prev.classes[0]?.id || 'default'),
          unitId,
          status: 'IN_PROGRESS',
          notes: activeNoteText
        });
      }
      return { ...prev, lessonProgress: updated };
    });
    setEditingNoteId(null);
  };

  // Group by official sections: المقطع الأول - المقطع الثاني - المقطع الثالث
  const sectionsMap = new Map<string, CurriculumUnit[]>();
  for (const unit of filteredUnits) {
    let key = `المقطع ${unit.sectionNumber || 1}`;
    if (unit.sectionNumber === 1) key = 'المقطع الأول (الفترة الأولى: سبتمبر - ديسمبر)';
    else if (unit.sectionNumber === 2) key = 'المقطع الثاني (الفترة الثانية: جانفي - مارس)';
    else if (unit.sectionNumber === 3) key = 'المقطع الثالث (الفترة الثالثة: أفريل - جوان)';
    else if (unit.sectionName) key = unit.sectionName;

    if (!sectionsMap.has(key)) {
      sectionsMap.set(key, []);
    }
    sectionsMap.get(key)!.push(unit);
  }

  // Get status for unit in active class
  const getUnitStatus = (unitId: string): LessonStatus => {
    if (!state.activeClassId) return 'NOT_STARTED';
    const progress = state.lessonProgress.find(
      p => p.classId === state.activeClassId && p.unitId === unitId
    );
    return progress?.status || 'NOT_STARTED';
  };

  const setUnitStatus = (unitId: string, status: LessonStatus) => {
    if (!state.activeClassId) return;
    onUpdateState(prev => {
      const existingIdx = prev.lessonProgress.findIndex(
        p => p.classId === prev.activeClassId && p.unitId === unitId
      );
      let updatedProgress = [...prev.lessonProgress];
      if (existingIdx >= 0) {
        updatedProgress[existingIdx] = {
          ...updatedProgress[existingIdx],
          status,
          completedAt: status === 'COMPLETED' ? new Date().toISOString().split('T')[0] : undefined
        };
      } else {
        updatedProgress.push({
          id: `prog-${uuidv4()}`,
          classId: prev.activeClassId!,
          unitId,
          status,
          completedAt: status === 'COMPLETED' ? new Date().toISOString().split('T')[0] : undefined
        });
      }
      return { ...prev, lessonProgress: updatedProgress };
    });
  };

  const handleOpenAddUnit = () => {
    setEditingUnit({
      id: `custom-u-${uuidv4()}`,
      level: selectedLevel,
      sectionNumber: 1,
      sectionName: 'مقطع إضافي / مخصص',
      unitNumber: (filteredUnits.length || 0) + 1,
      title: '',
      domain: 'العلوم الإسلامية',
      hourlyVolume: 2,
      targetedCompetence: '',
      learningObjectives: [],
      indicators: [],
      referenceTexts: []
    });
    setIsEditingModalOpen(true);
  };

  const handleOpenEditUnit = (unit: CurriculumUnit) => {
    setEditingUnit({ ...unit });
    setIsEditingModalOpen(true);
  };

  const handleSaveUnit = () => {
    if (!editingUnit || !editingUnit.title) return;

    onUpdateState(prev => {
      // Check if it's already in customUnits or if we're overriding an official unit
      const isCustom = prev.customUnits.some(u => u.id === editingUnit.id);
      let updatedCustom: CurriculumUnit[] = [];

      if (isCustom) {
        updatedCustom = prev.customUnits.map(u =>
          u.id === editingUnit.id ? (editingUnit as CurriculumUnit) : u
        );
      } else {
        // If editing an official unit or adding brand new, save into customUnits
        updatedCustom = [
          ...prev.customUnits.filter(u => u.id !== editingUnit.id),
          editingUnit as CurriculumUnit
        ];
      }
      return { ...prev, customUnits: updatedCustom };
    });

    setIsEditingModalOpen(false);
    setEditingUnit(null);
  };

  const handleDeleteCustomUnit = (unitId: string) => {
    onUpdateState(prev => ({
      ...prev,
      customUnits: prev.customUnits.filter(u => u.id !== unitId)
    }));
    setDeleteConfirmId(null);
  };

  const statusLabels: Record<LessonStatus, { label: string; bg: string; text: string }> = {
    NOT_STARTED: { label: 'لم يبدأ', bg: 'bg-slate-100', text: 'text-slate-600' },
    PLANNED: { label: 'مخطط له', bg: 'bg-blue-50', text: 'text-blue-700' },
    IN_PROGRESS: { label: 'قيد الإنجاز', bg: 'bg-amber-50', text: 'text-amber-800' },
    COMPLETED: { label: 'أُنجز بحمد الله', bg: 'bg-[var(--primary-soft)]', text: 'text-[var(--primary)]' },
    NEEDS_REMEDIAL: { label: 'يحتاج معالجة / إعادة', bg: 'bg-rose-50', text: 'text-rose-700' }
  };

  return (
    <div className="space-y-6 w-full max-w-[30rem] md:max-w-7xl mx-auto px-3 sm:px-6 md:px-8 py-4 sm:py-6" id="curriculum-view">


      {/* Level Selector Tabs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {OFFICIAL_LEVELS.map(lvl => {
          const isSelected = selectedLevel === lvl.id;
          return (
            <button
              key={lvl.id}
              onClick={() => setSelectedLevel(lvl.id)}
              className={`p-3 rounded-xl border text-right transition-all cursor-pointer ${
                isSelected
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm' : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50' }`}
            >
              <div className="text-xs font-bold">{lvl.name}</div>
              <div className={`text-[11px] mt-1 ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                {lvl.hoursTotal} ساعة • {lvl.unitsCount} وحدة • <span className="font-bold text-gold">{lvl.weeklyHours} سا/أسبوع</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Search & Class Progress Context Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <input
            type="text" placeholder="بحث في عناوين الدروس، الأهداف، السندات..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pr-9 pl-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-amber-600" />
        </div>

        {activeClass && (
          <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <span>متابعة تقدم القسم:</span>
            <span className="font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
              {activeClass.name} ({activeClass.stream})
            </span>
          </div>
        )}
      </div>

      {/* Sections and Units List */}
      <div className="space-y-6">
        {Array.from(sectionsMap.entries()).map(([sectionName, units]) => (
          <div key={sectionName} className="space-y-3">
            {/* Section Header */}
            <div className="bg-slate-100/90 px-4 py-2 rounded-lg border border-slate-200 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800">{sectionName}</h3>
              <span className="text-[11px] font-semibold text-slate-500">
                {units.length} وحدات
              </span>
            </div>

            {/* Units in this section */}
            <div className="space-y-3">
              {units.map(unit => {
                const currentStatus = getUnitStatus(unit.id);
                const isExpanded = expandedUnitId === unit.id;
                const statusInfo = statusLabels[currentStatus];
                const isCustom = state.customUnits.some(u => u.id === unit.id);

                return (
                  <div
                    key={unit.id}
                    className="bg-white rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all overflow-hidden" id={`unit-card-${unit.id}`}
                  >
                    {/* Unit Main Header Row */}
                    <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                          {unit.unitNumber}
                        </span>

                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
                              {unit.title}
                            </h4>
                            {isCustom && (
                              <span className="px-1.5 py-0.2 rounded bg-purple-50 text-navy border border-purple-200 text-[10px] font-bold">
                                مخصص
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-medium">
                              {unit.domain}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px] font-mono">
                              {unit.hourlyVolume} سا
                            </span>
                          </div>

                          {/* Competence full text & local PDF badge */}
                          <div className="flex flex-col gap-1.5 pt-1">
                            {unit.targetedCompetence && (
                              <div className="px-2 py-1 rounded-md bg-amber-100/80 text-amber-900 border border-amber-200 text-[11px] font-bold truncate" title={unit.targetedCompetence}>
                                الكفاءة: {unit.targetedCompetence}
                              </div>
                            )}
                            {getUnitNote(unit.id) && (
                              <div className="text-[11px] text-[var(--primary)] bg-[var(--primary-soft)] border border-[var(--primary)]/20 px-2 py-1 rounded truncate">
                                📝 {getUnitNote(unit.id)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right side: Status dropdown + Action Buttons */}
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {/* Status selector for active class */}
                        {state.activeClassId && (
                          <select
                            value={currentStatus}
                            onChange={e => setUnitStatus(unit.id, e.target.value as LessonStatus)}
                            className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer outline-none ${statusInfo.bg} ${statusInfo.text} border-slate-200`}
                          >
                            <option value="NOT_STARTED">لم يبدأ</option>
                            <option value="PLANNED">مخطط</option>
                            <option value="IN_PROGRESS">قيد الإنجاز</option>
                            <option value="COMPLETED">أُنجز</option>
                            <option value="NEEDS_REMEDIAL">يحتاج معالجة</option>
                          </select>
                        )}

                        {/* Manual Note Insertion button */}
                        <button
                          onClick={() => {
                            if (editingNoteId === unit.id) {
                              setEditingNoteId(null);
                            } else {
                              setEditingNoteId(unit.id);
                              setActiveNoteText(getUnitNote(unit.id));
                            }
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)] text-[var(--primary)] border border-[var(--primary)]/20 text-xs font-bold transition-colors cursor-pointer" title="أضف ملاحظة للوحدة" >
                          <FileText className="w-3.5 h-3.5" />
                          <span>أضف ملاحظة</span>
                        </button>

                        {/* Pedagogical Lesson Plan & Embedded PDF button */}
                        <button
                          onClick={() => onPrepareUnit(unit, 'pdf')}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)] text-[var(--text-primary)] border border-[var(--primary)] text-xs font-bold transition-colors cursor-pointer" title="عرض المذكرة البيداغوجية وملف PDF المدمج" >
                          <FileText className="w-3.5 h-3.5 text-[var(--primary)]" />
                          <span>المذكرة البيداغوجية (PDF)</span>
                        </button>

                        {/* Delete button if custom */}
                        {isCustom && (
                          <button
                            onClick={() => setDeleteConfirmId(unit.id)}
                            className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 cursor-pointer" title="حذف الوحدة" >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}

                        {/* Toggle details expansion */}
                        <button
                          onClick={() => setExpandedUnitId(isExpanded ? null : unit.id)}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer" title="عرض التفاصيل والأهداف" >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Inline Manual Note Editor Drawer */}
                    {editingNoteId === unit.id && (
                      <div className="bg-amber-50/60 border-t border-amber-200/80 p-3 flex flex-col sm:flex-row items-center gap-2">
                        <span className="text-xs font-bold text-[var(--primary)] shrink-0">
                          📝 إضافة ملاحظة للوحدة:
                        </span>
                        <input
                          type="text" value={activeNoteText}
                          onChange={e => setActiveNoteText(e.target.value)}
                          placeholder="اكتب ملاحظتك البيداغوجية، تنبيه، أو توصية للدرس..." className="flex-1 w-full text-xs bg-white border border-amber-300 rounded-lg px-3 py-1.5 focus:outline-[var(--primary)] text-slate-800" />
                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          <button
                            onClick={() => handleSaveUnitNote(unit.id)}
                            className="px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white text-xs font-bold hover:bg-[var(--primary-hover)] transition-colors cursor-pointer whitespace-nowrap" >
                            حفظ
                          </button>
                          <button
                            onClick={() => setEditingNoteId(null)}
                            className="px-3 py-1.5 rounded-lg bg-stone-200 text-stone-700 text-xs font-bold hover:bg-stone-300 transition-colors cursor-pointer whitespace-nowrap" >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Expandable Details Drawer */}
                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-100 p-4 space-y-4 text-xs">
                        {/* Learning Objective - الهدف التعلمي */}
                        {(unit.learningObjective || unit.targetedCompetence) && (
                          <div className="space-y-1">
                            <span className="font-bold text-emerald-950 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-[var(--primary)]"></span>
                              الهدف التعلمي:
                            </span>
                            <p className="text-[var(--text-primary)] bg-[var(--primary-soft)]/80 p-3 rounded-lg border border-[var(--primary)]/20 font-serif font-bold leading-relaxed">
                              {unit.learningObjective || unit.targetedCompetence}
                            </p>
                          </div>
                        )}

                        {/* Targeted Resources - الموارد المستهدفة */}
                        {((unit.targetedResources && unit.targetedResources.length > 0) || (unit.learningObjectives && unit.learningObjectives.length > 0)) && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                              الموارد المستهدفة (العناصر المفاهيمية وبناء التعلمات):
                            </span>
                            <ul className="list-decimal list-inside space-y-1 text-slate-700 bg-white p-3 rounded-lg border border-slate-200 font-serif leading-relaxed">
                              {(unit.targetedResources || unit.learningObjectives || []).map((obj, i) => (
                                <li key={i}>{obj}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Implementation Mechanisms - آلية تنفيذ التعلمات */}
                        {unit.implementationMechanisms && unit.implementationMechanisms.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-gold"></span>
                              آلية تنفيذ التعلمات (خطوات الإنجاز والأنشطة):
                            </span>
                            <div className="space-y-1.5 bg-amber-50/40 p-3 rounded-lg border border-amber-200/70">
                              {unit.implementationMechanisms.map((mech, i) => (
                                <div key={i} className="text-slate-800 font-serif flex items-start gap-2">
                                  <span className="font-bold text-amber-900 shrink-0">المرحلة {i + 1}:</span>
                                  <span>{mech}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Teacher Directives - توجيهات خاصة بالأستاذ */}
                        {((unit.teacherDirectives && unit.teacherDirectives.length > 0) || (unit.pedagogicalDirectives && unit.pedagogicalDirectives.length > 0)) && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-amber-950 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-amber-700"></span>
                              توجيهات خاصة بالأستاذ (ليست عناصر مفاهيمية):
                            </span>
                            <ul className="list-disc list-inside space-y-1 text-amber-950 bg-amber-50/70 p-3 rounded-lg border border-amber-200/80 font-serif leading-relaxed">
                              {(unit.teacherDirectives || unit.pedagogicalDirectives || []).map((dir, i) => (
                                <li key={i}>{dir}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Indicators & Evaluation */}
                        {unit.indicators && unit.indicators.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-[var(--primary)]"></span>
                              مؤشرات الأداء والتقويم:
                            </span>
                            <ul className="list-disc list-inside space-y-1 text-slate-700 bg-white p-3 rounded-lg border border-slate-200 font-serif leading-relaxed">
                              {unit.indicators.map((ind, i) => (
                                <li key={i}>{ind}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Reference Texts & Directives */}
                        {unit.referenceTexts && unit.referenceTexts.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="font-bold text-slate-900 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-[var(--primary)]"></span>
                              السندات والنصوص الشرعية المؤطرة:
                            </span>
                            <div className="bg-stone-50 p-3 rounded-lg border border-stone-200 text-stone-900 space-y-1">
                              {unit.referenceTexts.map((txt, i) => (
                                <p key={i} className="font-serif text-xs leading-relaxed">
                                  « {txt} »
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Quick CTA to open lesson note and embedded PDF */}
                        <div className="pt-2 flex items-center justify-end gap-2 flex-wrap">
                          <button
                            onClick={() => onPrepareUnit(unit, 'pdf')}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--text-primary)] hover:bg-[var(--primary-hover)] text-white text-xs font-bold transition-colors cursor-pointer" >
                            <FileText className="w-3.5 h-3.5 text-[var(--primary)]" />
                            <span>فتح بطاقة المذكرة وملف PDF المدمج</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Add Unit Modal */}
      {isEditingModalOpen && editingUnit && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div role="dialog" aria-modal="true" className="bg-white rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                {editingUnit.id?.startsWith('custom') ? 'إضافة وحدة' : 'تعديل بيانات الوحدة'}
              </h3>
              <button
                onClick={() => setIsEditingModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer" >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <label className="font-bold text-slate-700">عنوان الوحدة / الدرس:</label>
                  <input
                    type="text" value={editingUnit.title || ''}
                    onChange={e => setEditingUnit({ ...editingUnit, title: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-900 focus:outline-amber-600" placeholder="مثال: من مصادر التشريع الإسلامي..." />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">الحجم الساعي (ساعات):</label>
                  <input
                    type="number" min="1" max="10" value={editingUnit.hourlyVolume || 2}
                    onChange={e =>
                      setEditingUnit({ ...editingUnit, hourlyVolume: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono font-bold text-slate-900 focus:outline-amber-600" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">الميدان:</label>
                  <select
                    value={editingUnit.domain || 'القرآن الكريم والحديث الشريف'}
                    onChange={e => setEditingUnit({ ...editingUnit, domain: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-amber-600" >
                    <option value="القرآن الكريم والحديث الشريف">القرآن الكريم والحديث الشريف</option>
                    <option value="العقيدة والفكر">العقيدة والفكر</option>
                    <option value="الفقه وأصوله">الفقه وأصوله</option>
                    <option value="السيرة والحضارة">السيرة والحضارة</option>
                    <option value="توجيهات تربوية عامة">توجيهات تربوية عامة</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">المقطع / المحور:</label>
                  <input
                    type="text" value={editingUnit.sectionName || ''}
                    onChange={e => setEditingUnit({ ...editingUnit, sectionName: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-amber-600" placeholder="المقطع الأول / الفصل الأول..." />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">الكفاءة المستهدفة:</label>
                <textarea
                  rows={2}
                  value={editingUnit.targetedCompetence || ''}
                  onChange={e => setEditingUnit({ ...editingUnit, targetedCompetence: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-amber-600" placeholder="الكفاءة التي يسعى الدرس لتحقيقها..." />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">
                  الأهداف التعلمية (افصل بين الأهداف بنزول سطر جديد):
                </label>
                <textarea
                  rows={3}
                  value={(editingUnit.learningObjectives || []).join('\n')}
                  onChange={e =>
                    setEditingUnit({
                      ...editingUnit,
                      learningObjectives: e.target.value.split('\n').filter(Boolean)
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-amber-600" placeholder="الهدف الأول&#10;الهدف الثاني&#10;الهدف الثالث" />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">
                  السندات والنصوص المؤطرة (آيات وأحاديث - سطر لكل سند):
                </label>
                <textarea
                  rows={2}
                  value={(editingUnit.referenceTexts || []).join('\n')}
                  onChange={e =>
                    setEditingUnit({
                      ...editingUnit,
                      referenceTexts: e.target.value.split('\n').filter(Boolean)
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-amber-600" placeholder="سورة النساء: 105&#10;حديث: «من سلك طريقاً...»" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsEditingModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer" >
                إلغاء
              </button>
              <button
                onClick={handleSaveUnit}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gold hover:bg-gold text-white text-xs font-bold shadow-xs cursor-pointer" >
                <Save className="w-4 h-4" />
                <span>حفظ التعديلات</span>
              </button>
            </div>
          </div>
        </div>
      )}
          <ConfirmDialog
        isOpen={!!deleteConfirmId}
        title="تأكيد الحذف" message="هل أنت متأكد من حذف هذه الوحدة المخصصة؟" onConfirm={() => { if (deleteConfirmId) handleDeleteCustomUnit(deleteConfirmId); }}
        onCancel={() => setDeleteConfirmId(null)}
      />
</div>
  );
};
