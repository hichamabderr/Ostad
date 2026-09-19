import { CouncilStatistics, Student, StudentGrade } from './types';

/**
 * حساب نقطة التقويم المستمر (على 20) من المعايير الأربعة (كل منها على 5 نقاط):
 * 1. السلوك (5): ينقص منه عند الشغب.
 * 2. الغيابات والتأخرات (5): ينقص منه عند الغياب غير المبرر أو التأخر.
 * 3. تنظيم الكراس (5): ينقص منه عند عدم كتابة الدروس أو إهمال الكراس.
 * 4. المشاركة (5): ينقص منه عند عدم المشاركة أو التفاعل.
 */
export function calculateContinuousEvaluation(
  behaviorScore: number = 5,
  attendanceScore: number = 5,
  notebookScore: number = 5,
  participationScore: number = 5
): number {
  const b = Math.max(0, Math.min(5, isNaN(behaviorScore) ? 5 : behaviorScore));
  const a = Math.max(0, Math.min(5, isNaN(attendanceScore) ? 5 : attendanceScore));
  const n = Math.max(0, Math.min(5, isNaN(notebookScore) ? 5 : notebookScore));
  const p = Math.max(0, Math.min(5, isNaN(participationScore) ? 5 : participationScore));
  const total = b + a + n + p;
  return Math.round(total * 100) / 100;
}

/**
 * حساب المعدل الفصلي لمادة العلوم الإسلامية وفق الصيغة الوزارية الرسمية:
 * المعدل = [ (التقويم المستمر + الفرض المحروس) + (الاختبار * 2) ] / 4
 */
export function calculateStudentAverage(
  continuousEval: number | null,
  quiz: number | null,
  exam: number | null
): number | null {
  const isValidMark = (mark: number | null): mark is number =>
    mark !== null && Number.isFinite(mark) && mark >= 0 && mark <= 20;

  if (
    (continuousEval !== null && !isValidMark(continuousEval)) ||
    (quiz !== null && !isValidMark(quiz)) ||
    (exam !== null && !isValidMark(exam))
  ) {
    return null;
  }

  // The official average is only meaningful once all required marks exist.
  if (continuousEval === null || quiz === null || exam === null) {
    return null;
  }

  const avg = (continuousEval + quiz + exam * 2) / 4;
  return Math.round(avg * 100) / 100;
}

/**
 * حساب إحصائيات مجلس القسم وفق النموذج الرسمي لوزارة التربية الوطنية الجزائرية
 * الفئات المعتمدة في الوثائق الرسمية:
 * 1. أقل من 8
 * 2. مابين 8 و 10
 * 3. مابين 10 و 12
 * 4. مابين 12 و 14
 * 5. مابين 14 و 16
 * 6. أكبر من 16
 */
export function calculateCouncilStatistics(
  classId: string,
  trimester: 1 | 2 | 3,
  students: Student[],
  grades: StudentGrade[],
  absencesCountMap?: { [studentId: string]: number }
): CouncilStatistics {
  const classStudents = students.filter(s => s.classId === classId);
  const totalStudents = classStudents.length;

  const validGrades: { studentId: string; studentName: string; average: number }[] = [];

  for (const student of classStudents) {
    const studentGrade = grades.find(
      g => g.studentId === student.id && g.trimester === trimester
    );

    if (studentGrade) {
      const avg =
        studentGrade.calculatedAverage ??
        calculateStudentAverage(
          studentGrade.continuousEval,
          studentGrade.quiz,
          studentGrade.exam
        );

      if (avg !== null && !isNaN(avg)) {
        validGrades.push({
          studentId: student.id,
          studentName: student.fullName,
          average: avg
        });
      }
    }
  }

  const evaluatedCount = validGrades.length;

  if (evaluatedCount === 0) {
    return {
      classId,
      trimester,
      totalStudents,
      evaluatedCount: 0,
      averageScore: 0,
      passCount: 0,
      failCount: 0,
      passRate: 0,
      highestScore: 0,
      lowestScore: 0,
      topStudentName: '—',
      lowestStudentName: '—',
      lessThan8: 0,
      between8and10: 0,
      between10and12: 0,
      between12and14: 0,
      between14and16: 0,
      greaterThan16: 0,
      frequentAbsenteesCount: 0,
      needsFollowUpCount: 0
    };
  }

  // فرز الدرجات
  validGrades.sort((a, b) => a.average - b.average);

  let sum = 0;
  let passCount = 0;
  let lessThan8 = 0;
  let between8and10 = 0;
  let between10and12 = 0;
  let between12and14 = 0;
  let between14and16 = 0;
  let greaterThan16 = 0;

  for (const item of validGrades) {
    const val = item.average;
    sum += val;

    if (val >= 10) {
      passCount++;
    }

    if (val < 8) {
      lessThan8++;
    } else if (val < 10) {
      between8and10++;
    } else if (val < 12) {
      between10and12++;
    } else if (val < 14) {
      between12and14++;
    } else if (val < 16) {
      between14and16++;
    } else {
      greaterThan16++;
    }
  }

  const averageScore = Math.round((sum / evaluatedCount) * 100) / 100;
  const passRate = Math.round((passCount / evaluatedCount) * 10000) / 100;

  const lowestScore = validGrades[0].average;
  const lowestStudentName = validGrades[0].studentName;

  const highestScore = validGrades[validGrades.length - 1].average;
  const topStudentName = validGrades[validGrades.length - 1].studentName;

  let frequentAbsenteesCount = 0;
  if (absencesCountMap) {
    for (const student of classStudents) {
      if ((absencesCountMap[student.id] || 0) >= 4) {
        frequentAbsenteesCount++;
      }
    }
  }

  const needsFollowUpCount = lessThan8;

  return {
    classId,
    trimester,
    totalStudents,
    evaluatedCount,
    averageScore,
    passCount,
    failCount: evaluatedCount - passCount,
    passRate,
    highestScore,
    lowestScore,
    topStudentName,
    lowestStudentName,
    lessThan8,
    between8and10,
    between10and12,
    between12and14,
    between14and16,
    greaterThan16,
    frequentAbsenteesCount,
    needsFollowUpCount
  };
}
