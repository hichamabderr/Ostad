'use client';

import React, { useState, useEffect } from 'react';
import { AppState } from '@/lib/storage';
import { getMergedCurriculumUnits } from "@/lib/curriculum-data";
import { SanadTab } from './SidebarSanad';
import { Search, X, BookOpen, Users, ArrowLeft, GraduationCap, Building2 } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { AccessibleDialog } from './AccessibleDialog';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: AppState;
  onNavigate: (tab: SanadTab) => void;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  onPrepareUnit?: (unit: ReturnType<typeof getMergedCurriculumUnits>[number]) => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  state,
  onNavigate,
  onUpdateState,
  onPrepareUnit
}) => {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  // Keyboard shortcut for the global search remains available while the dialog is open.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!isOpen) return null;

  const q = debouncedQuery.trim().toLowerCase();

  // Search lessons
  const matchedUnits = !q
    ? []
    : getMergedCurriculumUnits(state.customUnits).filter(
        u =>
          u.title.toLowerCase().includes(q) ||
          u.domain.toLowerCase().includes(q) ||
          (u.referenceTexts && u.referenceTexts.some(t => t.toLowerCase().includes(q)))
      ).slice(0, 6);

  // Search students
  const matchedStudents = !q
    ? []
    : state.students
        .filter(s => s.fullName.toLowerCase().includes(q) || (s.regNumber && s.regNumber.includes(q)))
        .slice(0, 6);

  const matchedClasses = !q
    ? []
    : state.classes
        .filter(c => c.name.toLowerCase().includes(q) || c.stream.toLowerCase().includes(q))
        .slice(0, 6);

  return (
    <AccessibleDialog open={isOpen} titleId="global-search-title" onClose={onClose} className="bg-[#FFFFFF] max-w-xl w-full p-5 shadow-2xl border border-[#F1F3F5] text-[#182026] space-y-4 rounded-t-3xl sm:rounded-xl rounded-b-none sm:rounded-b-3xl mb-0 sm:mb-auto pb-8 sm:pb-6 max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95">
        {/* Search Header Input */}
        <div className="flex items-center gap-3 pb-3 border-b border-[#F1F3F5]">
          <div id="global-search-title" className="sr-only">البحث العام</div>
          <Search className="w-5 h-5 text-[#2E7D9B] shrink-0" />
          <input
            type="text" value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="ابحث عن وحدة، تلميذ، سند شرعي، مصطلح فقهي..." className="w-full bg-transparent focus:outline-hidden text-sm font-semibold placeholder:text-[#8C96A3]" autoFocus
          />
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-[#F8F9FA] text-[#8C96A3] hover:text-[#182026] cursor-pointer" >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Results Area */}
        <div className="max-h-[60vh] overflow-y-auto space-y-4 pr-1 scrollbar-thin">
          {!q && (
            <div className="py-8 text-center text-xs text-[#8C96A3]">
              اكتب كلمة للبحث الفوري في المنهاج الرسمي (1AS/2AS/3AS) أو أسماء التلاميذ.
            </div>
          )}

          {matchedClasses.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-[#8C96A3] uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-[#2E7D9B]" />
                <span>الأقسام ({matchedClasses.length})</span>
              </div>
              <div className="space-y-1">
                {matchedClasses.map(cls => {
                  const studentCount = state.students.filter(student => student.classId === cls.id).length;
                  return (
                    <div
                      key={cls.id}
                      className="w-full p-3 rounded-xl border border-[#F1F3F5] bg-[#F8F9FA] transition-all group text-right"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateState(prev => ({ ...prev, activeClassId: cls.id }));
                          onClose();
                          onNavigate('classes');
                        }}
                        className="w-full flex items-center justify-between cursor-pointer text-right"
                      >
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-[#182026] group-hover:text-[#2E7D9B] transition-colors">
                          {cls.name}
                        </div>
                        <div className="text-[11px] text-[#5A6672] mt-0.5">
                          {cls.stream} • {studentCount} تلميذ
                        </div>
                      </div>
                      <ArrowLeft className="w-4 h-4 text-[#8C96A3] group-hover:text-[#2E7D9B] group-hover:-translate-x-1 transition-all" aria-hidden="true" />
                      </button>
                      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[#F1F3F5]">
                        {([
                          ['attendance', 'الحضور'],
                          ['grades', 'النقاط'],
                          ['sessions', 'دفتر النصوص'],
                        ] as const).map(([tab, label]) => (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => {
                              onUpdateState(prev => ({ ...prev, activeClassId: cls.id }));
                              onClose();
                              onNavigate(tab);
                            }}
                            className="min-h-9 px-2 rounded-lg text-[10px] font-bold text-[#2E7D9B] bg-white border border-[#F1F3F5] hover:border-[#2E7D9B] cursor-pointer"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Lessons Section */}
          {matchedUnits.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-[#8C96A3] uppercase tracking-wider flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-[#2E7D9B]" />
                <span>الوحدات والدروس في المنهاج ({matchedUnits.length})</span>
              </div>
              <div className="space-y-1">
                {matchedUnits.map(unit => (
                  <button
                    key={unit.id}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onClose();
                        if (onPrepareUnit) {
                          onPrepareUnit(unit);
                        } else {
                          onNavigate('curriculum');
                        }
                      }
                    }}
                    onClick={() => {
                      onClose();
                      if (onPrepareUnit) {
                        onPrepareUnit(unit);
                      } else {
                        onNavigate('curriculum');
                      }
                    }}
                    className="p-3 rounded-xl border border-[#F1F3F5] hover:border-[#2E7D9B] bg-[#F8F9FA] hover:bg-[#FFFFFF] flex items-center justify-between cursor-pointer transition-all group" >
                    <div>
                      <div className="font-bold text-xs text-[#182026] group-hover:text-[#2E7D9B] transition-colors">
                        {unit.title}
                      </div>
                      <div className="text-[11px] text-[#5A6672] flex items-center gap-2 mt-0.5">
                        <span className="font-semibold text-[#2E7D9B]">{unit.level}</span>
                        <span>•</span>
                        <span>{unit.domain}</span>
                      </div>
                    </div>
                    <ArrowLeft className="w-4 h-4 text-[#8C96A3] group-hover:text-[#2E7D9B] group-hover:-translate-x-1 transition-all" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Students Section */}
          {matchedStudents.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-[#8C96A3] uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-blue-600" />
                <span>قائمة التلاميذ ({matchedStudents.length})</span>
              </div>
              <div className="space-y-1">
                {matchedStudents.map(st => {
                  const cls = state.classes.find(c => c.id === st.classId);
                  return (
                    <button
                      key={st.id}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (cls) {
                            onUpdateState(prev => ({ ...prev, activeClassId: cls.id }));
                          }
                          onClose();
                          onNavigate('classes');
                        }
                      }}
                      onClick={() => {
                        if (cls) {
                          onUpdateState(prev => ({ ...prev, activeClassId: cls.id }));
                        }
                        onClose();
                        onNavigate('classes');
                      }}
                      className="p-3 rounded-xl border border-[#F1F3F5] hover:border-[#2E7D9B] bg-[#F8F9FA] hover:bg-[#FFFFFF] flex items-center justify-between cursor-pointer transition-all group" >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 font-bold text-xs flex items-center justify-center">
                          {st.fullName.charAt(0)}
                        </div>
                        <div>
                          <div className="font-bold text-xs text-[#182026] group-hover:text-[#2E7D9B] transition-colors">
                            {st.fullName}
                          </div>
                          <div className="text-[11px] text-[#5A6672] flex items-center gap-2">
                            <span>{cls?.name || 'قسم غير محدد'}</span>
                            {st.regNumber && <span>رقم: {st.regNumber}</span>}
                          </div>
                        </div>
                      </div>
                      <ArrowLeft className="w-4 h-4 text-[#8C96A3] group-hover:text-[#2E7D9B] group-hover:-translate-x-1 transition-all" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {q && matchedUnits.length === 0 && matchedStudents.length === 0 && matchedClasses.length === 0 && (
            <div className="py-8 text-center text-xs text-[#8C96A3]">
              لم يتم العثور على نتائج مطابقة لـ &quot;{query}&quot;
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="pt-2 border-t border-[#DEE2E6] flex items-center justify-between text-[11px] text-[#8E95A0]">
          <span>اضغط ESC للإغلاق</span>
          <span className="text-[#2E7D9B] font-semibold">معين - التعليم الثانوي</span>
        </div>
    </AccessibleDialog>
  );
};
