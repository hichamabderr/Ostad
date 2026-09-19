import * as XLSX from 'xlsx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { GradeLevel, Student, StudentGrade } from './types';
import { v4 as uuidv4 } from 'uuid';
import { parseAlgerianClass, getCanonicalClassName, getStudentNameKey } from './name-normalizer';

export interface ParsedClassData {
  sheetName: string;
  className: string;
  level: GradeLevel;
  stream: string;
  students: Omit<Student, 'classId'>[];
}

export interface ParsedDigitizationResult {
  classes: ParsedClassData[];
  totalStudents: number;
  schoolName?: string;
  stateName?: string;
  academicYear?: string;
}

/**
 * Detects GradeLevel and Stream (الشعبة) from class text and sheet code according to the Algerian Educational System.
 */
export function detectLevelAndStream(
  rawText: string,
  sheetName?: string
): { level: GradeLevel; stream: string } {
  const combinedText = `${rawText} ${sheetName || ''}`.trim();
  const parsed = parseAlgerianClass(combinedText);
  
  if (parsed) {
    return { level: parsed.level, stream: parsed.officialStream };
  }

  return { level: '2AS', stream: 'غير مصنف' };
}

/**
 * Detects if a cell or text represents a summary/total/statistical row at the bottom of an Excel sheet
 * such as "مجموع الذكور", "مجموع الإناث", "مجموع الذكور والإناث", "المجموع العام", "العدد الإجمالي", "المعيدون", etc.
 */
export function isSchoolSummaryOrFooterRow(text: unknown, rowCells?: unknown[]): boolean {
  if (!text) return false;
  const raw = String(text).trim();
  if (!raw) return false;

  const compact = raw.replace(/[\s:_ـ\-#\d\.\/\\()]+/g, '');
  const norm = raw.replace(/[\s:_ـ\-#\d\.\/\\()]+/g, ' ').trim();

  // 1. Direct compact keywords found in Algerian school sheets
  const summaryKeywords = [
    'ذكور', 'إناث', 'اناث', 'الذكور', 'الإناث', 'الاناث',
    'مجموع', 'المجموع', 'المجموعالعام', 'المجموعالكلي', 'مجموعالقسم', 'مجموعالتلاميذ',
    'مجموعالذكور', 'مجموعالإناث', 'مجموعالاناث', 'مجموعالذكورو الإناث', 'مجموعالذكوروالإناث',
    'مجموعالذكورو الإناث', 'مجموعالذكوروالاناث',
    'عددالذكور', 'عددالإناث', 'عددالاناث', 'تعدادالذكور', 'تعدادالإناث', 'تعدادالتلاميذ',
    'إجمالي', 'الاجمالي', 'العددالإجمالي', 'العدداإجمالي', 'العدداجمالي',
    'المعيدون', 'المعيدين', 'معيدون', 'معيدين', 'تكرار', 'إحصاء', 'احصاء',
    'توقيعالمدير', 'توقيعالأستاذ', 'المدير', 'الناظر', 'مستشارالتربية', 'ملاحظة', 'ملاحظات'
  ];

  if (summaryKeywords.includes(compact)) return true;

  // 2. Starts with / contains key phrases
  if (/^(?:مجموع|المجموع|عدد|تعداد|إجمالي|اجمالي|إحصاء|احصاء)\s*(?:ال?ذكور|ال?إ?ناث|ال?تلاميذ|ال?قسم|ال?عام|ال?كلي)?/i.test(norm)) {
    return true;
  }

  if (/^(?:ال?ذكور|ال?إ?ناث|ال?معيد(?:ون|ين))(?:\s*[:：\d]|$)/i.test(norm)) {
    return true;
  }

  if (/مجموع\s*(?:ال?ذكور|ال?إ?ناث|القسم|العام|الكلي|التلاميذ)/i.test(raw)) return true;
  if (/(?:عدد|تعداد)\s*(?:ال?ذكور|ال?إ?ناث|التلاميذ)/i.test(raw)) return true;
  if (/توقيع\s*(?:المدير|الأستاذ|الناظر)/i.test(raw)) return true;

  // 3. Check row cells if provided
  if (Array.isArray(rowCells) && rowCells.length > 0) {
    const fullRow = rowCells.map(c => String(c || '').trim()).join(' ');
    if (
      /مجموع\s*(?:ال?ذكور|ال?إ?ناث|القسم|العام)|المجموع\s*العام|تعداد\s*التلاميذ|إحصاء\s*التلاميذ/i.test(fullRow) &&
      /ذكور|إناث|المجموع/i.test(fullRow)
    ) {
      return true;
    }
  }

  return false;
}

export interface SheetColumnIndices {
  headerRowIndex: number;
  dataStartRowIndex: number;
  regNumberCol: number;
  lastNameCol: number;
  firstNameCol: number;
  birthDateCol: number;
  continuousCol: number;
  quizCol: number;
  examCol: number;
  estimationCol: number;
  guidanceCol: number;
}

/**
 * Dynamically detects the column layout of a sheet in the official Algerian digitization file.
 * Correctly accounts for sheets starting at Column A or Column B, and reads ministerial code tags.
 */
export function detectSheetColumnIndices(data: any[][]): SheetColumnIndices {
  let headerRowIndex = 7;
  let dataStartRowIndex = 8;
  let regNumberCol = -1;
  let lastNameCol = -1;
  let firstNameCol = -1;
  let birthDateCol = -1;
  let continuousCol = -1;
  let quizCol = -1;
  let examCol = -1;
  let estimationCol = -1;
  let guidanceCol = -1;

  for (let r = 0; r < Math.min(data.length, 18); r++) {
    const row = data[r] || [];
    const rowText = row.map(c => String(c || '').trim()).join(' ');

    const isArabicHeader = rowText.includes('اللقب') && (rowText.includes('الاسم') || rowText.includes('التعريف'));
    const isTechHeader = /matricule/i.test(rowText) && /nom/i.test(rowText);

    if (isArabicHeader || isTechHeader) {
      headerRowIndex = r;
      dataStartRowIndex = r + 1;

      row.forEach((cell, c) => {
        const val = String(cell || '').trim();
        if (/رقم\s*التعريف|matricule|رقم\s*التسجيل|التعريف\s*الوطني/i.test(val)) regNumberCol = c;
        else if (/اللقب|nom/i.test(val)) lastNameCol = c;
        else if (/الاسم|prenom/i.test(val)) firstNameCol = c;
        else if (/تاريخ\s*الميلاد|date_n|الميلاد/i.test(val)) birthDateCol = c;
        else if (/التقويم\s*المستمر|التقويم|^01$/i.test(val)) continuousCol = c;
        else if (/معدل\s*الفروض|الفرض|فروض|^03$/i.test(val)) quizCol = c;
        else if (/الاختبار|امتحان|^09$/i.test(val)) examCol = c;
        else if (/التقديرات|التقدير|^obs$/i.test(val)) estimationCol = c;
        else if (/الإرشادات|الارشادات|توجيهات|^cons$/i.test(val)) guidanceCol = c;
      });

      if (r > 0) {
        const prevRow = data[r - 1] || [];
        prevRow.forEach((cell, c) => {
          const val = String(cell || '').trim();
          if (/matricule/i.test(val) && regNumberCol === -1) regNumberCol = c;
          if (/^01$/.test(val) && continuousCol === -1) continuousCol = c;
          if (/^03$/.test(val) && quizCol === -1) quizCol = c;
          if (/^09$/.test(val) && examCol === -1) examCol = c;
          if (/^obs$/i.test(val) && estimationCol === -1) estimationCol = c;
          if (/^cons$/i.test(val) && guidanceCol === -1) guidanceCol = c;
        });
      }

      if (isTechHeader && r + 1 < data.length) {
        const nextRow = data[r + 1] || [];
        const nextRowText = nextRow.map(c => String(c || '').trim()).join(' ');
        if (nextRowText.includes('اللقب') || nextRowText.includes('الاسم')) {
          headerRowIndex = r + 1;
          dataStartRowIndex = r + 2;
          nextRow.forEach((cell, c) => {
            const val = String(cell || '').trim();
            if (/رقم\s*التعريف/i.test(val)) regNumberCol = c;
            else if (/اللقب/i.test(val)) lastNameCol = c;
            else if (/الاسم/i.test(val)) firstNameCol = c;
            else if (/تاريخ\s*الميلاد/i.test(val)) birthDateCol = c;
            else if (/التقويم/i.test(val)) continuousCol = c;
            else if (/الفرض|فروض/i.test(val)) quizCol = c;
            else if (/الاختبار/i.test(val)) examCol = c;
            else if (/التقديرات/i.test(val)) estimationCol = c;
            else if (/الارشادات/i.test(val)) guidanceCol = c;
          });
        }
      }
      break;
    }
  }

  const baseCol = regNumberCol >= 0 ? regNumberCol : (lastNameCol >= 1 ? lastNameCol - 1 : 0);
  if (regNumberCol === -1) regNumberCol = baseCol;
  if (lastNameCol === -1) lastNameCol = baseCol + 1;
  if (firstNameCol === -1) firstNameCol = baseCol + 2;
  if (birthDateCol === -1) birthDateCol = baseCol + 3;
  if (continuousCol === -1) continuousCol = baseCol + 4;
  if (quizCol === -1) quizCol = baseCol + 5;
  if (examCol === -1) examCol = baseCol + 6;
  if (estimationCol === -1) estimationCol = baseCol + 7;
  if (guidanceCol === -1) guidanceCol = baseCol + 8;

  return {
    headerRowIndex,
    dataStartRowIndex,
    regNumberCol,
    lastNameCol,
    firstNameCol,
    birthDateCol,
    continuousCol,
    quizCol,
    examCol,
    estimationCol,
    guidanceCol,
  };
}

/**
 * Parses all sheets of the official Algerian digitisation file to extract ALL classes and student rosters.
 */
export async function parseDigitizationFile(
  file: File
): Promise<ParsedDigitizationResult> {
  const arrayBuffer = await file.arrayBuffer();

  let workbook;
  try {
    workbook = XLSX.read(arrayBuffer, { type: 'array' });
  } catch (err) {
    throw new Error('عذراً، يبدو أن ملف الإكسل غير صالح أو لا يتطابق مع التنسيق الوزاري المعتمد.');
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('الملف فارغ أو غير صالح (لا توجد أوراق عمل).');
  }

  const parsedClasses: ParsedClassData[] = [];
  let detectedSchoolName = '';
  let detectedStateName = '';
  let detectedAcademicYear = '';

  // Process EVERY sheet in the workbook
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    // Convert sheet to matrix of cells
    const data = XLSX.utils.sheet_to_json<any[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: true,
    });

    if (!data || data.length === 0) continue;

    let extractedClassName = '';
    const cols = detectSheetColumnIndices(data);
    const dataStartIndex = cols.dataStartRowIndex;

    // Scan the header rows
    const scanLimit = Math.min(data.length, dataStartIndex);
    for (let i = 0; i < scanLimit; i++) {
      const row = data[i];
      if (!row) continue;

      const rowText = row
        .map(cell => String(cell || '').trim())
        .filter(Boolean)
        .join(' ');

      // Extract School Name (ثانوية ...)
      if (!detectedSchoolName && /ثانوية\s+([^\n\r,]+)/i.test(rowText)) {
        const m = rowText.match(/ثانوية\s+([^,:\n\r]+(?:\([^)]+\))?)/i);
        if (m && m[1]) {
          detectedSchoolName = `ثانوية ${m[1].trim()}`;
        }
      }

      // Extract Directorate / State (مديرية التربية لولاية ...)
      if (!detectedStateName && /مديرية\s*التربية\s*لولاية\s+([^\s,:\n\r]+)/i.test(rowText)) {
        const m = rowText.match(/مديرية\s*التربية\s*لولاية\s+([^\s,:\n\r]+)/i);
        if (m && m[1]) {
          detectedStateName = m[1].trim();
        }
      }

      // Extract Academic Year (السنة الدراسية : 2025-2026)
      if (!detectedAcademicYear && /السنة\s*الدراسية\s*:\s*(\d{4}[-/]\d{4})/i.test(rowText)) {
        const m = rowText.match(/السنة\s*الدراسية\s*:\s*(\d{4}[-/]\d{4})/i);
        if (m && m[1]) {
          detectedAcademicYear = m[1].trim();
        }
      }

      // Extract Class Name (الفوج التربوي : ...)
      if (rowText.includes('الفوج التربوي')) {
        const match = rowText.match(/الفوج\s*التربوي\s*:\s*(.*?)\s*(?:مادة|$)/i);
        if (match && match[1]) {
          extractedClassName = match[1].trim();
        }
      }
    }

    // Fallback for class name if not found in text: use sheet name or default
    if (!extractedClassName) {
      if (sheetName && sheetName !== 'Sheet1') {
        extractedClassName = `فوج ${sheetName}`;
      } else {
        extractedClassName = `قسم ${parsedClasses.length + 1}`;
      }
    }

    // Determine Level and Stream accurately
    const { level, stream } = detectLevelAndStream(extractedClassName, sheetName);

    // Parse students in this sheet using dynamically detected columns
    const students: Omit<Student, 'classId'>[] = [];
    let numberInList = 1;

    for (let i = dataStartIndex; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;

      const regNumber = String(row[cols.regNumberCol] || '').trim();
      const lastName = String(row[cols.lastNameCol] || '').trim();
      const firstName = String(row[cols.firstNameCol] || '').trim();

      if (!regNumber && !lastName && !firstName) {
        continue;
      }

      // Stop if we hit footer summary text (e.g. مجموع الذكور والإناث)
      const combinedName = `${lastName} ${firstName}`.trim();
      if (
        isSchoolSummaryOrFooterRow(lastName, row) ||
        isSchoolSummaryOrFooterRow(firstName, row) ||
        isSchoolSummaryOrFooterRow(combinedName, row) ||
        isSchoolSummaryOrFooterRow(regNumber, row)
      ) {
        break;
      }

      const birthDateText = row[cols.birthDateCol];
      let birthDate = '';
      if (birthDateText) {
        if (birthDateText instanceof Date) {
          birthDate = birthDateText.toISOString().split('T')[0];
        } else if (typeof birthDateText === 'number' && birthDateText > 10000) {
          const date = XLSX.SSF.parse_date_code(birthDateText);
          if (date) {
            birthDate = `${date.y}-${String(date.m).padStart(2, '0')}-${String(
              date.d
            ).padStart(2, '0')}`;
          }
        } else {
          birthDate = String(birthDateText).trim();
        }
      }

      const fullName = `${lastName} ${firstName}`.trim();

      if (fullName || regNumber) {
        students.push({
          id: uuidv4(),
          numberInList,
          fullName: fullName || `تلميذ ${numberInList}`,
          regNumber: regNumber || undefined,
          registrationNumber: regNumber || undefined,
          birthDate: birthDate || undefined,
          gender: 'M',
        });
        numberInList++;
      }
    }

    // Only add class if it has students or was explicitly named
    if (students.length > 0) {
      parsedClasses.push({
        sheetName,
        className: getCanonicalClassName(extractedClassName || sheetName),
        level,
        stream,
        students,
      });
    }
  }

  if (parsedClasses.length === 0) {
    throw new Error(
      'لم يتم العثور على أي تلاميذ في الملف. تأكد من أن الملف هو الملف الرسمي للرقمنة ويحتوي على جدول التلاميذ.'
    );
  }

  const totalStudents = parsedClasses.reduce(
    (acc, cls) => acc + cls.students.length,
    0
  );

  return {
    classes: parsedClasses,
    totalStudents,
    schoolName: detectedSchoolName || undefined,
    stateName: detectedStateName || undefined,
    academicYear: detectedAcademicYear || undefined,
  };
}

/**
 * Injects grades directly IN-PLACE into the official digitisation file.
 * Patches only the target worksheet XML files inside the original XLSX package:
 * - Keeps hidden rows (rows 6 & 7) hidden.
 * - Keeps all styling, borders, colors, column widths, row heights, and views intact.
 * - DOES NOT regenerate the workbook or use aoa_to_sheet/XLSX.write.
 * - Matches students by National ID (رقم التعريف) or by normalized full name.
 */
export async function injectGradesIntoFile(
  file: File,
  students: Student[],
  grades: StudentGrade[]
): Promise<{ blob: Blob; matchedStudents: number; gradesWritten: number }> {
  const arrayBuffer = await file.arrayBuffer();
  const originalZip = unzipSync(new Uint8Array(arrayBuffer));
  let workbook;
  try {
    workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellStyles: true,
      cellNF: true,
      cellDates: true,
    });
  } catch (err) {
    throw new Error('عذراً، يبدو أن ملف الإكسل غير صالح أو لا يتطابق مع التنسيق الوزاري المعتمد.');
  }

  const gradeLookupByReg = new Map<string, StudentGrade>();
  const gradeLookupByName = new Map<string, StudentGrade>();
  const matchedStudentIds = new Set<string>();
  let gradesWritten = 0;

  const normalizeRegNumber = (value: unknown): string => {
    const normalized = String(value ?? '')
      .trim()
      .replace(/\.0+$/, '')
      .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    return normalized.replace(/\s+/g, '');
  };

  students.forEach(student => {
    const grade = grades.find(g => g.studentId === student.id);
    if (grade) {
      const regNumber = normalizeRegNumber(student.regNumber || student.registrationNumber);
      if (regNumber) {
        gradeLookupByReg.set(regNumber, grade);
      }
      if (student.fullName) {
        gradeLookupByName.set(getStudentNameKey(student.fullName), grade);
      }
    }
  });

  const readCellText = (worksheet: XLSX.WorkSheet, r: number, c: number): string => {
    const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
    if (!cell) return '';
    return String(cell.w ?? cell.v ?? '').trim();
  };

  const escapeXml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  const sheetXmlByName = new Map<string, string>();
  const workbookXml = strFromU8(originalZip['xl/workbook.xml']);
  const relationshipsXml = strFromU8(originalZip['xl/_rels/workbook.xml.rels']);
  const relationshipTargets = new Map<string, string>();
  relationshipsXml.replace(/<Relationship\b([^>]*)\/>/g, (_match, attrs: string) => {
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relationshipTargets.set(id, `xl/${target.replace(/^\/+/, '')}`);
    return _match;
  });
  workbookXml.replace(/<sheet\b([^>]*)\/>/g, (_match, attrs: string) => {
    const name = attrs.match(/\bname="([^"]+)"/)?.[1];
    const relationshipId = attrs.match(/\br:id="([^"]+)"/)?.[1];
    const target = relationshipId && relationshipTargets.get(relationshipId);
    if (name && target) sheetXmlByName.set(name, target);
    return _match;
  });

  const pendingCellValues = new Map<string, Map<string, number | string>>();
  const setCellValueInPlace = (sheetPath: string, r: number, c: number, val: number | string) => {
    const sheetValues = pendingCellValues.get(sheetPath) || new Map<string, number | string>();
    sheetValues.set(XLSX.utils.encode_cell({ r, c }), val);
    pendingCellValues.set(sheetPath, sheetValues);
  };

  workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return;

    const data = XLSX.utils.sheet_to_json<any[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: true,
    });
    if (!data || data.length === 0) return;

    const cols = detectSheetColumnIndices(data);

    for (let r = cols.dataStartRowIndex; r < data.length; r++) {
      const row = data[r];
      if (!row) continue;

      // Use the displayed cell text for long national IDs; converting a 15-digit
      // Excel number through JavaScript can otherwise lose precision.
      const regNumber = normalizeRegNumber(readCellText(worksheet, r, cols.regNumberCol) || row[cols.regNumberCol]);
      const lastName = readCellText(worksheet, r, cols.lastNameCol) || String(row[cols.lastNameCol] || '').trim();
      const firstName = readCellText(worksheet, r, cols.firstNameCol) || String(row[cols.firstNameCol] || '').trim();
      const fullName = `${lastName} ${firstName}`.trim().replace(/\s+/g, ' ');

      if (!regNumber && !lastName && !firstName) continue;

      if (
        lastName.includes('المجموع') ||
        lastName.includes('توقيع') ||
        regNumber.includes('المجموع')
      ) {
        break;
      }

      const grade =
        (regNumber ? gradeLookupByReg.get(regNumber) : null) ||
        (fullName ? gradeLookupByName.get(getStudentNameKey(fullName)) : null);

      if (grade) {
        matchedStudentIds.add(grade.studentId);
        if (grade.continuousEval !== null && grade.continuousEval !== undefined && cols.continuousCol !== -1) {
          setCellValueInPlace(sheetXmlByName.get(sheetName) || '', r, cols.continuousCol, Number(grade.continuousEval));
          gradesWritten++;
        }
        if (grade.quiz !== null && grade.quiz !== undefined && cols.quizCol !== -1) {
          setCellValueInPlace(sheetXmlByName.get(sheetName) || '', r, cols.quizCol, Number(grade.quiz));
          gradesWritten++;
        }
        if (grade.exam !== null && grade.exam !== undefined && cols.examCol !== -1) {
          setCellValueInPlace(sheetXmlByName.get(sheetName) || '', r, cols.examCol, Number(grade.exam));
          gradesWritten++;
        }
        if (grade.estimation && grade.estimation.trim() !== '' && cols.estimationCol !== -1) {
          setCellValueInPlace(sheetXmlByName.get(sheetName) || '', r, cols.estimationCol, grade.estimation.trim());
          gradesWritten++;
        }
        if (grade.guidance && grade.guidance.trim() !== '' && cols.guidanceCol !== -1) {
          setCellValueInPlace(sheetXmlByName.get(sheetName) || '', r, cols.guidanceCol, grade.guidance.trim());
          gradesWritten++;
        }
      }
    }
  });

  pendingCellValues.forEach((values, sheetPath) => {
    const xml = strFromU8(originalZip[sheetPath]);
    let updatedXml = xml;
    values.forEach((value, cellRef) => {
      const cellPattern = new RegExp(
        `<c\\b(?=[^>]*\\br="${cellRef}")([^>]*)\\/>|<c\\b(?=[^>]*\\br="${cellRef}")([^>]*)>([\\s\\S]*?)<\\/c>`
      );
      updatedXml = updatedXml.replace(cellPattern, (_match, attrsSelfClosing, attrsWithBody) => {
        const attrs = String(attrsSelfClosing || attrsWithBody || '')
          .replace(/\s+t="[^"]*"/g, '');
        if (typeof value === 'number') {
          return `<c${attrs}><v>${String(value)}</v></c>`;
        }
        return `<c${attrs} t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
      });
    });
    if ((updatedXml.match(/<row\b/g) || []).length !== (xml.match(/<row\b/g) || []).length) {
      throw new Error('تعذر الحفاظ على جميع صفوف ملف الرقمنة الأصلي؛ أُلغي الحقن ولم يتم إنشاء ملف ناقص.');
    }
    originalZip[sheetPath] = strToU8(updatedXml);
  });

  const outputBuffer = zipSync(originalZip, { level: 0 });

  return {
    blob: new Blob([outputBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    matchedStudents: matchedStudentIds.size,
    gradesWritten
  };
}
