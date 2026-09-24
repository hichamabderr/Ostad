export interface TeacherProfile {
  name: string; // الاسم الكامل
  title: string; // e.g. "أستاذ التعليم الثانوي للعلوم الإسلامية"
  schoolName: string; // e.g. "ثانوية الشهيد زيغود يوسف"
  stateName: string; // ولاية e.g. "الجزائر وسط" / "وهران" / "سطيف" / "قسنطينة"
  academicYear: string; // e.g. "2026/2027"
  hijriYear?: string; // e.g. "1448 هـ"
  // Detailed Civil & Professional Profile (Sanad Al-Oustadh format)
  firstNameAr?: string;
  lastNameAr?: string;
  firstNameEn?: string;
  lastNameEn?: string;
  email?: string;
  phoneNumber?: string;
  avatarUrl?: string; // رابط أو كود Base64 للصورة الشخصية
  avatarStorageKey?: string;
  firstAppointmentDate?: string; // تاريخ أول تعيين بالقطاع لحساب سنوات الخبرة تلقائياً
  experienceYears?: number;
  birthDate?: string;
  birthPlace?: string;
  familyStatus?: string;
  gender?: 'M' | 'F';
}

export interface OfficialHoliday {
  id: string;
  name: string;
  dateStr: string; // e.g. "01 نوفمبر 2026" or "19 مارس 2027"
  type: 'national' | 'religious' | 'term';
}

export interface ContinuousEvaluationRules {
  behaviorMax: number; // 5
  attendanceMax: number; // 5
  notebookMax: number; // 5
  participationMax: number; // 5
  disruptionDeduction: number; // خصم الشغب (افتراضياً 1.0)
  unwrittenLessonDeduction: number; // خصم عدم كتابة الدروس (افتراضياً 1.0)
  unexcusedAbsenceDeduction: number; // خصم الغياب غير المبرر (افتراضياً 1.0)
  lateDeduction: number; // خصم التأخر (افتراضياً 0.5)
  participationBonus: number; // علاوة المشاركة (افتراضياً 0.5)
  lackOfParticipationDeduction?: number;
  maxScore: number; // 20
  showGuidanceAlerts: boolean;
  exemptRuleSecondQuiz: string; // legacy text key, kept for backward compatibility
}

export interface AcademicCalendarSettings {
  termDates: {
    term1Start: string;
    term1End: string;
    term2Start: string;
    term2End: string;
    term3Start: string;
    term3End: string;
  };
  holidays: OfficialHoliday[];
  evaluationRules: ContinuousEvaluationRules;
  timetableSettings: {
    dayStart: string; // "08:00 AM"
    dayEnd: string; // "05:00 PM"
    activeDays: number[]; // [0, 1, 2, 3, 4]
  };
}

export type AppTheme = 'light' | 'dark' | 'sepia';
export type DashboardStyle = 'executive' | 'academic_hub';

export type GradeLevel = '1AS_ARTS' | '1AS_SCIENCE' | '2AS' | '3AS';

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';

export interface Student {
  id: string;
  classId: string;
  numberInList: number;
  fullName: string;
  regNumber?: string; // رقم التسجيل بالرقمنة
  registrationNumber?: string;
  gender?: 'M' | 'F';
  birthDate?: string;
  notes?: string;
  isRepeater?: boolean; // تلميذ معيد للسنة
  guardianPhone?: string; // هاتف الولي
}

export interface ClassRoom {
  id: string;
  name: string; // e.g. "3 ع ت 1" أو "1 ج م آداب 2"
  level: GradeLevel;
  stream: string; // الشعبة: علوم تجريبية، تقني رياضي، آداب وفلسفة، لغات أجنبية، تسيير واقتصاد، إلخ
  roomNumber?: string;
  color?: string;
}

/** Compact, synchronized fields used by the session editor. */
export interface SessionEditorContract {
  summary: string;
  assignments: string;
}

export interface TimetableSlot {
  id: string;
  classId: string;
  dayOfWeek: 0 | 1 | 2 | 3 | 4; // 0=Sunday (الأحد), 1=Monday (الإثنين), 2=Tuesday (الثلاثاء), 3=Wednesday (الأربعاء), 4=Thursday (الخميس)
  startTime: string; // "08:00"
  endTime: string; // "09:00" or "10:00"
  room?: string;
  type?: string;
}

export type LessonStatus = 'NOT_STARTED' | 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'NEEDS_REMEDIAL';

export interface CurriculumUnit {
  id: string;
  level: GradeLevel;
  sectionNumber: number;
  sectionName: string; // المقطع: المقطع الأول، المقطع الثاني...
  unitNumber: number;
  title: string; // عنوان الوحدة
  domain: string; // الميدان: القرآن الكريم والحديث، العقيدة والفكر، الفقه وأصوله، السيرة والحضارة
  hourlyVolume: number; // الحجم الساعي / الزمن
  targetedCompetence?: string; // الكفاءة المستهدفة
  learningObjective?: string; // الهدف التعلمي (وفق التدرجات ومؤشرات الأداء)
  learningObjectives?: string[]; // الأهداف التعلمية
  targetedResources?: string[]; // الموارد المستهدفة (العناصر المفاهيمية)
  implementationMechanisms?: string[]; // آلية تنفيذ التعلمات
  indicators?: string[]; // مؤشرات الأداء والتقويم
  referenceTexts?: string[]; // السندات والنصوص المؤطرة
  teacherDirectives?: string[]; // توجيهات خاصة بالأستاذ (ليست عناصر مفاهيمية)
  pedagogicalDirectives?: string[]; // توجيهات خاصة بالأستاذ (للتوافق)
  learningSteps?: { stepName: string; content: string }[]; // مراحل الإنجاز والإيضاح والتحليل
  pdfUrl?: string; // رابط أو مسار ملف المذكرة PDF
  pdfFileName?: string;
  pdfBase64?: string;
}

export interface AttachedPdfDocument {
  unitId: string;
  fileName: string;
  fileDataUrl?: string; // Base64 data URL
  fileUrl?: string; // Direct URL
  fileSize?: number;
  uploadedAt: string;
}

export interface ClassLessonProgress {
  id: string;
  classId: string;
  unitId: string;
  status: LessonStatus;
  startedAt?: string;
  completedAt?: string;
  notes?: string;
  remedialNotes?: string;
}

export interface SessionRecord {
  id: string;
  classId: string;
  unitId?: string;
  customTopic?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // "08:00"
  endTime: string; // "09:00"
  sessionGoals: string; // أهداف الحصة
  accomplishments: string; // ما تم إنجازه
  nextSteps: string; // ما يحتاج معالجة في الحصة القادمة
  /** Compact editor aliases retained alongside the legacy notebook fields. */
  summary?: string;
  assignments?: string;
  teacherNotes: string; // ملاحظات الأستاذ
  notes?: string; // دفتر الملاحظات الموحد
  // Legacy notebook fields kept for backward compatibility with older backups.
  memoryWhatWorked?: string; // ماذا نجح؟
  memoryWhatFailed?: string; // ماذا لم ينجح؟
  memoryDifficulty?: string; // ما الصعوبة؟
  memoryNextTimeChange?: string; // ما الذي يجب تغييره للمرة القادمة؟
  attendance: { [studentId: string]: AttendanceStatus };
  type?: string;
  // Behavior & Evaluation Tracking per Session
  disruptions?: string[]; // Array of studentIds who were disruptive (شغب)
  unwrittenLessons?: string[]; // Array of studentIds who didn't write the lesson (بدون كراس)
  poorParticipation?: string[]; // Array of studentIds with poor participation
  goodParticipation?: string[]; // Array of studentIds with exceptional participation
}

export interface StudentGrade {
  id: string;
  studentId: string;
  classId: string;
  trimester: 1 | 2 | 3;
  continuousEval: number | null; // التقويم المستمر الإجمالي (على 20)
  // عناصر التقويم المستمر الأربعة (كل عنصر على 5 نقاط):
  behaviorScore?: number | null; // السلوك (على 5)
  attendanceScore?: number | null; // الغيابات والتأخرات (على 5)
  notebookScore?: number | null; // تنظيم الكراس وكتابة الدروس (على 5)
  participationScore?: number | null; // المشاركة والتفاعل (على 5)
  // تفاصيل التقييم وسجل الملاحظات:
  disruptionsCount?: number; // عدد مرات الشغب المسجلة
  unwrittenLessonsCount?: number; // عدد مرات عدم كتابة الدروس
  lackOfParticipationCount?: number; // عدد مرات عدم المشاركة
  quiz: number | null; // الفرض الأول (على 20)
  secondQuiz?: number | null; // legacy field (غير مستعمل في مادة العلوم الإسلامية)
  isSecondQuizExempt?: boolean; // legacy field (غير مستعمل في مادة العلوم الإسلامية)
  exam: number | null; // الاختبار (على 20)
  calculatedAverage?: number | null; // المعدل الفصلي
  estimation?: string; // التقدير الرسمي: ممتاز، جيد جداً، جيد، إلخ
  guidance?: string; // الإرشادات والتوجيهات البيداغوجية
  remarks?: string; // الملاحظة
  followUpNotes?: string; // المتابعة
}

export type GroupRole = 'LEADER' | 'REPORTER' | 'SPOKESPERSON' | 'TIMEKEEPER' | 'MEMBER';

export interface SmartGroupMember {
  student: Student;
  role: GroupRole;
}

export interface SmartGroup {
  id: string;
  name: string;
  color: string;
  members: SmartGroupMember[];
  assignedTask?: string;
}

export interface CouncilStatistics {
  classId: string;
  trimester: 1 | 2 | 3;
  totalStudents: number;
  evaluatedCount: number;
  averageScore: number;
  passCount: number; // >= 10
  failCount: number; // < 10
  passRate: number; // %
  highestScore: number;
  lowestScore: number;
  topStudentName: string;
  lowestStudentName: string;
  // Bands according to official Algerian format:
  lessThan8: number;
  between8and10: number;
  between10and12: number;
  between12and14: number;
  between14and16: number;
  greaterThan16: number;
  // Qualitative
  frequentAbsenteesCount: number;
  needsFollowUpCount: number;
}

export interface LessonPlan {
  id: string;
  unitId?: string;
  title: string;
  level: GradeLevel;
  content?: string;
  domain?: string;
  targetCompetence?: string;
  learningObjectives?: string[];
  problemSituation?: string; // الوضعية المشكلة الانطلاقية
  pedagogicalMeans?: string[]; // الوسائل والسندات
  steps?: {
    stage: string; // مرحلة التمهيد / التحليل / الاستنتاج / التقويم
    timing: string;
    teacherActivity: string;
    studentActivity: string;
    contentSummary: string;
  }[];
  formativeEvaluation?: string; // التقويم التكويني
  remedialPlan?: string; // معالجة التعثر المحتمل
  boardSchema?: string; // مخطط السبورة
  createdAt: string;
  updatedAt?: string;
}
