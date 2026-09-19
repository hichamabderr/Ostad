import * as XLSX from 'xlsx';
import { GradeLevel } from './types';
import { detectLevelAndStream, isSchoolSummaryOrFooterRow } from './excel-sync';
import { normalizeClassName, getCanonicalClassName } from './name-normalizer';

export interface MoumtazeStudent {
  numberInList: number;
  fullName: string;
  gender: 'M' | 'F';
  birthDate?: string;
  birthPlace?: string;
  isRepeater: boolean;
  fatherName?: string;
  address?: string;
}

export interface MoumtazeClass {
  id: string;
  sheetName: string;
  className: string;
  normalizedClassName: string;
  level: GradeLevel;
  stream: string;
  roomNumber?: string;
  students: MoumtazeStudent[];
}

export interface ParsedMoumtazeResult {
  classes: MoumtazeClass[];
  schoolName?: string;
  stateName?: string;
  academicYear?: string;
  fileName: string;
}

/**
 * Formats Excel date values (serial number, Date object, or text) into standard YYYY-MM-DD or DD/MM/YYYY.
 */
function formatExcelDate(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') {
    const trimmed = val.trim();
    // If it's already YYYY-MM-DD or DD/MM/YYYY
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(trimmed) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(trimmed)) {
      return trimmed;
    }
  }

  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Check if Excel numeric serial date (e.g. 39299 = 2007-08-07)
  const num = Number(val);
  if (!isNaN(num) && num > 20000 && num < 60000) {
    try {
      const parsed = XLSX.SSF.parse_date_code(num);
      if (parsed && parsed.y) {
        const y = parsed.y;
        const m = String(parsed.m).padStart(2, '0');
        const d = String(parsed.d).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    } catch {
      // Fallback
    }
  }

  return String(val).trim();
}

/**
 * Checks whether a sheet is an institutional/admin sheet rather than a pedagogical class roster.
 */
function isIgnoredAdminSheet(sheetName: string): boolean {
  const norm = sheetName.trim().toLowerCase();
  return /^(مجموع|وافدون|وافدون مغادرون|مغادرون|feuil\s*\d*|sheet\s*\d*|الأوائل|الاوائل|إحصائ|احصائ|توجيه|توزيع|نتائج|تقرير|بطاقة)/i.test(
    norm
  );
}

/**
 * Parses an Algerian "الممتاز" (Moumtaze) Excel workbook containing school class rosters.
 */
export async function parseMoumtazeFile(file: File): Promise<ParsedMoumtazeResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
  });

  const parsedClasses: MoumtazeClass[] = [];
  let detectedSchoolName: string | undefined;
  let detectedStateName: string | undefined;
  let detectedAcademicYear: string | undefined;

  for (const sheetName of workbook.SheetNames) {
    if (isIgnoredAdminSheet(sheetName)) {
      continue;
    }

    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    // Convert to 2D array of rows
    const rows = XLSX.utils.sheet_to_json<any[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (!rows || rows.length < 5) continue;

    let roomNumber: string | undefined;
    let explicitClassName: string | undefined;
    let headerRowIdx = -1;
    let colNum = -1;
    let colName = -1;
    let colBirthDate = -1;
    let colBirthPlace = -1;
    let colGender = -1;
    let colRepeater = -1;
    let colFather = -1;
    let colAddress = -1;

    // 1. Scan the top rows (rows 0-14) for metadata and table header
    for (let r = 0; r < Math.min(rows.length, 16); r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;

      for (let c = 0; c < row.length; c++) {
        const cellStr = String(row[c] || '').trim();
        if (!cellStr) continue;

        // School Name (ثانوية ...)
        if (!detectedSchoolName && /ثانوية\s+[^\n\r]+/i.test(cellStr)) {
          const match = cellStr.match(/(ثانوية\s+[^\n\r]+)/i);
          if (match) detectedSchoolName = match[1].trim();
        }

        // Directorate / State (مديرية التربية لولاية ...)
        if (!detectedStateName && /مديرية\s+التربية/i.test(cellStr)) {
          const stateMatch = cellStr.match(/لولاية\s+([^\s\n\r]+)/i);
          if (stateMatch) {
            detectedStateName = stateMatch[1].trim();
          } else {
            detectedStateName = cellStr.replace(/مديرية\s+التربية\s*/i, '').trim();
          }
        }

        // Academic Year (2024-2025 / 2025-2024)
        if (!detectedAcademicYear && /(?:20\d{2}\s*[-/]\s*20\d{2})/i.test(cellStr)) {
          const ym = cellStr.match(/(20\d{2})\s*[-/]\s*(20\d{2})/);
          if (ym) {
            const y1 = Number(ym[1]);
            const y2 = Number(ym[2]);
            const startYear = Math.min(y1, y2);
            const endYear = Math.max(y1, y2);
            detectedAcademicYear = `${startYear}/${endYear}`;
          }
        }

        // Room Number (القاعة : 5 / القاعة : 17 / القاعة: 29)
        if (!roomNumber && /القاعة\s*[:：]/i.test(cellStr)) {
          const rm = cellStr.match(/القاعة\s*[:：]\s*([^\s\n\r]+|\d+)/i);
          if (rm && rm[1]) {
            roomNumber = rm[1].trim();
          }
        }

        // Class Name in yellow box (e.g. 3 ع ت 01, 1 ج م آداب 01, 3أف, 3 ل أ ألمانية, 2 تقني رياضي)
        if (
          !explicitClassName &&
          /^(?:[123]\s*(?:ع\s*ت|ج\s*م|ت\s*ر|ت\s*اقتصاد|آداب|لغات|أف|ل\s*أ|تقني|رياضي)|\d+\s*أف)/i.test(
            cellStr
          ) &&
          !cellStr.includes('وزارة') &&
          !cellStr.includes('الجمهورية') &&
          !cellStr.includes('القائمة')
        ) {
          explicitClassName = cellStr;
        }
      }

      // Check if this row is the table header
      const rowTexts = row.map(v => String(v || '').trim());
      const hasNumberCol = rowTexts.some(t => /^رقم$/i.test(t));
      const hasNameCol = rowTexts.some(t =>
        /إ?سم.*لقب|لقب.*إ?سم|اسم\s*التلميذ|الاسم\s*واللقب/i.test(t)
      );

      if (hasNameCol || (hasNumberCol && rowTexts.some(t => /ميلاد|تاريخ/i.test(t)))) {
        headerRowIdx = r;

        // Map column indexes
        rowTexts.forEach((headerText, colIdx) => {
          if (/^رقم$/i.test(headerText)) {
            colNum = colIdx;
          } else if (/إ?سم.*لقب|لقب.*إ?سم|اسم\s*التلميذ|الاسم\s*واللقب/i.test(headerText)) {
            colName = colIdx;
          } else if (/تاريخ.*ميلاد/i.test(headerText)) {
            colBirthDate = colIdx;
          } else if (/مكان.*ميلاد/i.test(headerText)) {
            colBirthPlace = colIdx;
          } else if (/^جنس$/i.test(headerText)) {
            colGender = colIdx;
          } else if (/تكرار|إعادة/i.test(headerText)) {
            colRepeater = colIdx;
          } else if (/إ?سم.*أب/i.test(headerText)) {
            colFather = colIdx;
          } else if (/عنوان/i.test(headerText)) {
            colAddress = colIdx;
          }
        });

        break; // Found table header row
      }
    }

    // If no student table header was detected in this sheet, skip it
    if (headerRowIdx === -1 || colName === -1) {
      continue;
    }

    // Determine final class name
    let finalClassName = explicitClassName || sheetName;
    // Clean up finalClassName (e.g. replace double spaces)
    finalClassName = finalClassName.replace(/\s+/g, ' ').trim();

    // If sheetName has something informative and explicitClassName was short
    if (!explicitClassName && sheetName) {
      finalClassName = sheetName;
    }
    
    // Apply canonical normalization for exact matching with Digitization
    const canonicalName = getCanonicalClassName(finalClassName);

    // Detect level and stream
    const { level, stream } = detectLevelAndStream(finalClassName, sheetName);

    // 2. Parse students in this class
    const students: MoumtazeStudent[] = [];

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;

      const rawName = String(row[colName] || '').trim();
      if (!rawName) continue;

      // Cleaned string for checking statistical / summary rows
      const cleanName = rawName.replace(/[\s:_ـ\-#]+/g, ' ').trim();
      const compactName = cleanName.replace(/\s+/g, '');

      // Strict filter: stop and skip summary keywords found at bottom of Moumtaze sheets
      // e.g. "مجموع الذكور والإناث", "مجموع الذكور", "مجموع الإناث", "ذكور", "إناث", "المجموع", "المعيدون", etc.
      if (
        isSchoolSummaryOrFooterRow(cleanName, row) ||
        isSchoolSummaryOrFooterRow(compactName, row) ||
        isSchoolSummaryOrFooterRow(rawName, row)
      ) {
        continue;
      }

      // Reject non-student garbage (too short or purely digits/symbols)
      if (cleanName.length < 2 || /^[\d\s\-_.]+$/.test(cleanName)) {
        continue;
      }

      // Check student number
      let num = students.length + 1;
      if (colNum !== -1) {
        const parsedNum = parseInt(String(row[colNum] || ''), 10);
        if (!isNaN(parsedNum) && parsedNum > 0) {
          num = parsedNum;
        }
      }

      // Gender: 'ذ' -> M, 'إناث'/'انثى'/'أنثى'/'F'/'ث' -> F
      let gender: 'M' | 'F' = 'M';
      if (colGender !== -1) {
        const rawGender = String(row[colGender] || '').trim();
        if (/إناث|انثى|أنثى|f|female|بنت|ث/i.test(rawGender)) {
          gender = 'F';
        }
      }

      // Repeater (تكرار: س1, س2, س3, معيد, نعم)
      let isRepeater = false;
      if (colRepeater !== -1) {
        const rawRep = String(row[colRepeater] || '').trim();
        if (/س\s*\d+|معيد|نعم|تكرار|[123]/i.test(rawRep)) {
          isRepeater = true;
        }
      }

      // Birth date & place
      const birthDate = colBirthDate !== -1 ? formatExcelDate(row[colBirthDate]) : undefined;
      const birthPlace = colBirthPlace !== -1 ? String(row[colBirthPlace] || '').trim() : undefined;
      const fatherName = colFather !== -1 ? String(row[colFather] || '').trim() : undefined;
      const address = colAddress !== -1 ? String(row[colAddress] || '').trim() : undefined;

      students.push({
        numberInList: num,
        fullName: rawName,
        gender,
        birthDate: birthDate || undefined,
        birthPlace: birthPlace || undefined,
        isRepeater,
        fatherName: fatherName || undefined,
        address: address || undefined,
      });
    }

    // Guarantee that all students in this class are strictly numbered 1..N starting from 1
    students.forEach((st, idx) => {
      st.numberInList = idx + 1;
    });

    if (students.length > 0) {
      parsedClasses.push({
        id: `moumtaze-cls-${sheetName}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        sheetName,
        className: canonicalName,
        normalizedClassName: normalizeClassName(canonicalName),
        level,
        stream,
        roomNumber,
        students,
      });
    }
  }

  return {
    classes: parsedClasses,
    schoolName: detectedSchoolName,
    stateName: detectedStateName,
    academicYear: detectedAcademicYear,
    fileName: file.name,
  };
}
