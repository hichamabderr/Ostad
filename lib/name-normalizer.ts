/**
 * Utility functions for normalizing, parsing, and unifying Algerian secondary school
 * student names and class names according to official Algerian curricula standards,
 * ensuring 100% harmonization between "الممتاز" (Moumtaze) and "الرقمنة" (Digitization).
 */

import { GradeLevel } from './types';

/**
 * Standard Algerian Stream Keys across 1AS, 2AS, and 3AS
 */
export type AlgerianStreamKey =
  | '1AS_SCIENCE'
  | '1AS_ARTS'
  | 'SCIENCES'
  | 'MATH'
  | 'TECH_MATH'
  | 'ECONOMICS'
  | 'LITERATURE'
  | 'LANGUAGES_ES'
  | 'LANGUAGES_DE'
  | 'LANGUAGES_IT'
  | 'LANGUAGES_RU'
  | 'LANGUAGES_GEN'
  | 'UNKNOWN';

export interface ParsedAlgerianClass {
  raw: string;
  levelNumber: 1 | 2 | 3;
  level: GradeLevel;
  streamKey: AlgerianStreamKey;
  officialStream: string;
  subSpecialty?: string;
  groupNumber: number;
  canonicalName: string;
  canonicalKey: string;
}

/**
 * Comprehensive dictionary of Algerian streams and all their possible aliases across
 * Moumtaze, Digitization (الرقمنة), schedule grids, and teacher shorthand.
 */
export const ALGERIAN_STREAM_MAPPINGS = [
  // 1. الرياضيات (Mathematics)
  {
    key: 'MATH' as AlgerianStreamKey,
    officialName: 'رياضيات',
    shortCode: 'ر',
    aliases: [
      'رياضيات', 'رياضي', 'رياضيات 1', 'رياضيات 2', 'ر', 'ريا',
      'ثانية ثانوي رياضيات', 'ثالثة ثانوي رياضيات',
      '2 رياضيات', '3 رياضيات', '2ر', '3ر'
    ]
  },
  // 2. العلوم التجريبية (Experimental Sciences)
  {
    key: 'SCIENCES' as AlgerianStreamKey,
    officialName: 'علوم تجريبية',
    shortCode: 'ع ت',
    aliases: [
      'علوم تجريبية', 'علوم تجريبيه', 'علوم', 'ع ت', 'عت', 'ع.ت',
      'ثانية ثانوي علوم تجريبية', 'ثالثة ثانوي علوم تجريبية',
      '2ع ت', '3ع ت', '2 ع ت', '3 ع ت'
    ]
  },
  // 3. التقني رياضي (Technical Mathematics)
  {
    key: 'TECH_MATH' as AlgerianStreamKey,
    officialName: 'تقني رياضي',
    shortCode: 'ت ر',
    aliases: [
      'تقني رياضي', 'تقني', 'ت ر', 'تر', 'ت.ر',
      'هندسة طرائق', 'هندسة مدنية', 'هندسة كهربائية', 'هندسة ميكانيكية',
      'طرائق', 'مدنية', 'كهربائية', 'ميكانيكية',
      'ثانية ثانوي تقني رياضي', 'ثالثة ثانوي تقني رياضي',
      '2 تقني رياضي', '3 تقني رياضي', '2 ت ر', '3 ت ر'
    ]
  },
  // 4. التسيير والاقتصاد (Management & Economics)
  {
    key: 'ECONOMICS' as AlgerianStreamKey,
    officialName: 'تسيير واقتصاد',
    shortCode: 'ت اقتصاد',
    aliases: [
      'تسيير واقتصاد', 'تسيير و اقتصاد', 'تسيير', 'اقتصاد', 'ت اقتصاد', 'ت.اقتصاد', 'ت إ', 'ت ا', 'ت.إ', 'تا',
      'ثانية ثانوي تسيير واقتصاد', 'ثالثة ثانوي تسيير واقتصاد',
      '2 ت اقتصاد', '3ت اقتصاد', '3 ت اقتصاد', '2 ت إ', '3 ت إ'
    ]
  },
  // 5. الآداب والفلسفة (Literature & Philosophy)
  {
    key: 'LITERATURE' as AlgerianStreamKey,
    officialName: 'آداب وفلسفة',
    shortCode: 'آف',
    aliases: [
      'آداب وفلسفة', 'آداب و فلسفة', 'اداب وفلسفة', 'فلسفة', 'فلسفه', 'آف', 'اف', 'أف', 'آ.ف', 'أ.ف',
      'ثانية ثانوي آداب وفلسفة', 'ثالثة ثانوي آداب وفلسفة',
      '2آف', '3آف', '2 آف', '3 آف', '3آف (عام)'
    ]
  },
  // 6. اللغات الأجنبية - إسبانية (Foreign Languages - Spanish)
  {
    key: 'LANGUAGES_ES' as AlgerianStreamKey,
    officialName: 'لغات أجنبية',
    subSpecialty: 'إسبانية',
    shortCode: 'لغات (إسبانية)',
    aliases: [
      'لغات أجنبية إسبانية', 'لغات اجنبية اسبانية', 'لغات إسبانية', 'لغات اسبانية',
      '2ل أ إسبانية', '3ل أ إسبانية', '2ل أ اسبانية', '3ل أ اسبانية',
      'إسبانية', 'اسبانية', 'إسباني', 'اسباني', 'esp'
    ]
  },
  // 7. اللغات الأجنبية - ألمانية (Foreign Languages - German)
  {
    key: 'LANGUAGES_DE' as AlgerianStreamKey,
    officialName: 'لغات أجنبية',
    subSpecialty: 'ألمانية',
    shortCode: 'لغات (ألمانية)',
    aliases: [
      'لغات أجنبية ألمانية', 'لغات اجنبية المانية', 'لغات ألمانية', 'لغات المانية',
      '2ل أ ألمانية', '3ل أ ألمانية', '2ل أ المانية', '3ل أ المانية',
      'ألمانية', 'المانية', 'ألماني', 'الماني', 'ger', 'all'
    ]
  },
  // 8. اللغات الأجنبية - إيطالية (Foreign Languages - Italian)
  {
    key: 'LANGUAGES_IT' as AlgerianStreamKey,
    officialName: 'لغات أجنبية',
    subSpecialty: 'إيطالية',
    shortCode: 'لغات (إيطالية)',
    aliases: [
      'لغات أجنبية إيطالية', 'لغات اجنبية ايطالية', 'لغات إيطالية', 'لغات ايطالية',
      '2ل أ إيطالية', '3ل أ إيطالية', '2ل أ ايطالية', '3ل أ ايطالية',
      'إيطالية', 'ايطالية', 'إيطالي', 'ايطالي', 'ita'
    ]
  },
  // 9. اللغات الأجنبية - عامة (Foreign Languages - General)
  {
    key: 'LANGUAGES_GEN' as AlgerianStreamKey,
    officialName: 'لغات أجنبية',
    shortCode: 'لغات أجنبية',
    aliases: ['لغات أجنبية', 'لغات اجنبية', 'لغات', 'ل أ', 'ل.أ', 'لأ']
  },
  // 10. الجذع المشترك علوم وتكنولوجيا (1AS Science)
  {
    key: '1AS_SCIENCE' as AlgerianStreamKey,
    officialName: 'جذع مشترك علوم وتكنولوجيا',
    shortCode: '1 ج م ع ت',
    aliases: [
      'جذع مشترك علوم وتكنولوجيا', 'جذع مشترك علوم', 'علوم وتكنولوجيا',
      '1 ج م ع ت', '1ج م ع ت', '1 ج م ع', '1ج م ع', '1 ج م ع ت 01',
      'أولى ثانوي جذع مشترك علوم وتكنولوجيا', 'اولى ثانوي جذع مشترك علوم وتكنولوجيا'
    ]
  },
  // 11. الجذع المشترك آداب (1AS Arts)
  {
    key: '1AS_ARTS' as AlgerianStreamKey,
    officialName: 'جذع مشترك آداب',
    shortCode: '1 ج م آداب',
    aliases: [
      'جذع مشترك آداب', 'جذع مشترك اداب', 'ج م آداب', 'ج م اداب',
      '1 ج م آ', '1 ج م ا', '1ج م آ', '1ج م ا', '1 ج م آداب 01',
      'أولى ثانوي جذع مشترك آداب', 'اولى ثانوي جذع مشترك اداب'
    ]
  }
];

/**
 * Normalizes an Arabic string for resilient matching:
 * - Strips Tashkeel (diacritics) and Tatweel
 * - Normalizes Alef variations (أ, إ, آ -> ا)
 * - Normalizes Taa Marbouta (ة -> ه)
 * - Normalizes Alif Maqsura and Yaa (ى -> ي)
 * - Collapses whitespace and trims
 */
export function normalizeArabicText(str: string): string {
  if (!str) return '';
  return str
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove tashkeel
    .replace(/[ـ]/g, '') // remove tatweel
    .replace(/[أإآء]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Stable identity key for imports. Unlike fuzzy matching, this key never treats
 * a partial name as a confirmed identity.
 */
export function getStudentNameKey(name: string): string {
  return normalizeArabicText(name)
    .split(' ')
    .filter(Boolean)
    .join(' ');
}

/**
 * Checks if two student names are the same, handling spelling variations,
 * extra spaces, and firstName/lastName order permutations.
 */
export function isSameStudentName(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  const n1 = normalizeArabicText(name1);
  const n2 = normalizeArabicText(name2);
  
  if (n1 === n2) return true;

  const parts1 = n1.split(' ').filter(Boolean);
  const parts2 = n2.split(' ').filter(Boolean);

  // Exact inverted order check (e.g., "العرابي مريم" vs "مريم العرابي")
  if (parts1.length === 2 && parts2.length === 2) {
    if (parts1[0] === parts2[1] && parts1[1] === parts2[0]) {
      return true;
    }
  }

  // Multi-part name comparison: if all significant words of one name exist in the other
  if (parts1.length >= 2 && parts2.length >= 2) {
    const isSubset1In2 = parts1.every(p => parts2.includes(p));
    const isSubset2In1 = parts2.every(p => parts1.includes(p));
    if (isSubset1In2 || isSubset2In1) {
      return true;
    }
  }

  return false;
}

/**
 * Parses any Algerian class string (from Moumtaze, Digitization, Timetable, or Manual input)
 * into its exact canonical level, stream, subSpecialty, and group number.
 */
export function parseAlgerianClass(rawName: string): ParsedAlgerianClass | null {
  if (!rawName || typeof rawName !== 'string') return null;
  const raw = rawName.trim();
  if (!raw) return null;

  // Clean text: remove tashkeel, normalize alef/taa
  const text = raw
    .replace(/[\u064B-\u065F\u0670ـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه');

  // 1. Detect Level
  let levelNumber: 1 | 2 | 3 | null = null;
  let textWithoutLevelPrefix = text;

  if (/^(?:3|3AS|س3|3ثانوي|3\s*ثانوي)\b/i.test(text) || /ثالثه|ثالثة|بكالوريا|باك/i.test(text)) {
    levelNumber = 3;
  } else if (/^(?:2|2AS|س2|2ثانوي|2\s*ثانوي)\b/i.test(text) || /ثانيه|ثانية/i.test(text)) {
    levelNumber = 2;
  } else if (/^(?:1|1AS|س1|1ثانوي|1\s*ثانوي)\b/i.test(text) || /اولي|أولى|اولى|جذع\s*مشترك|1\s*ج/i.test(text)) {
    levelNumber = 1;
  }

  // If level starts with digit at the beginning (e.g. "2 رياضيات", "3 ع ت 01", "1 ج م ع ت 01")
  const leadingDigitMatch = text.match(/^([123])\s*(.*)$/);
  if (leadingDigitMatch) {
    levelNumber = Number(leadingDigitMatch[1]) as 1 | 2 | 3;
    textWithoutLevelPrefix = leadingDigitMatch[2];
  } else {
    // If it started with words like "ثانية ثانوي رياضيات 1" or "الفوج التربوي : ثانية ثانوي..."
    textWithoutLevelPrefix = text
      .replace(/^(?:الفوج\s*التربوي\s*:)?\s*(?:السنه|السنة|قسم|فوج)?\s*(?:ثالثه|ثالثة|ثانيه|ثانية|اولي|أولى|اولى)\s*(?:ثانوي)?\s*/i, '')
      .trim();
  }

  if (!levelNumber) {
    if (/ثالثه|ثالثة|3AS/i.test(text)) levelNumber = 3;
    else if (/ثانيه|ثانية|2AS/i.test(text)) levelNumber = 2;
    else if (/اولي|أولى|اولى|1AS/i.test(text)) levelNumber = 1;
    else levelNumber = 2; // Default fallback
  }

  // 2. Detect Stream & SubSpecialty
  let streamKey: AlgerianStreamKey = 'UNKNOWN';
  let officialStream = 'غير مصنف';
  let subSpecialty: string | undefined = undefined;

  // PRIORITY: 1AS streams (Always separate from 2AS/3AS)
  if (levelNumber === 1) {
    if (/اداب|آداب|1\s*ج\s*م\s*آ|1\s*ج\s*م\s*ا|ج\s*م\s*اداب|ج\s*م\s*آداب|1ج\s*م\s*آ/i.test(text)) {
      streamKey = '1AS_ARTS';
      officialStream = 'جذع مشترك آداب';
    } else {
      streamKey = '1AS_SCIENCE';
      officialStream = 'جذع مشترك علوم وتكنولوجيا';
    }
  }
  // Foreign Languages (لغات أجنبية)
  else if (
    /لغات\s*اجنبيه|لغات\s*أجنبية|لغات|ل\s*أ|ل\.أ|لأ/i.test(text) ||
    /اسبانيه|إسبانية|اسباني|المانيه|ألمانية|الماني|ايطاليه|إيطالية|ايطالي|روسيه|روسية/i.test(text)
  ) {
    officialStream = 'لغات أجنبية';
    if (/اسبانيه|إسبانية|اسباني|إسباني|esp/i.test(text)) {
      streamKey = 'LANGUAGES_ES';
      subSpecialty = 'إسبانية';
    } else if (/المانيه|ألمانية|الماني|ألماني|all|ger/i.test(text)) {
      streamKey = 'LANGUAGES_DE';
      subSpecialty = 'ألمانية';
    } else if (/ايطاليه|إيطالية|ايطالي|إيطالي|ita/i.test(text)) {
      streamKey = 'LANGUAGES_IT';
      subSpecialty = 'إيطالية';
    } else if (/روسيه|روسية|روسي/i.test(text)) {
      streamKey = 'LANGUAGES_RU';
      subSpecialty = 'روسية';
    } else {
      streamKey = 'LANGUAGES_GEN';
    }
  }
  // Literature & Philosophy (آداب وفلسفة)
  else if (
    /اداب|آداب|فلسفه|فلسفة|آف|اف|أف|آ\.ف|أ\.ف/i.test(text) ||
    /^آف\b|^اف\b|^أف\b/i.test(textWithoutLevelPrefix)
  ) {
    streamKey = 'LITERATURE';
    officialStream = 'آداب وفلسفة';
  }
  // Technical Math (تقني رياضي)
  else if (
    /تقني\s*رياضي|تقني|ت\s*ر|ت\.ر|تر(?!\s*ك)|هندسه\s*(?:طرائق|مدنيه|كهربائيه|ميكانيكيه)|هندسة\s*(?:طرائق|مدنية|كهربائية|ميكانيكية)/i.test(
      text
    )
  ) {
    streamKey = 'TECH_MATH';
    officialStream = 'تقني رياضي';
    if (/طرائق/i.test(text)) subSpecialty = 'هندسة طرائق';
    else if (/مدني/i.test(text)) subSpecialty = 'هندسة مدنية';
    else if (/كهربا/i.test(text)) subSpecialty = 'هندسة كهربائية';
    else if (/ميكانيك/i.test(text)) subSpecialty = 'هندسة ميكانيكية';
  }
  // Management & Economics (تسيير واقتصاد)
  else if (
    /تسيير\s*و\s*اقتصاد|تسيير\s*واقتصاد|تسيير|ت\s*اقتصاد|ت\.اقتصاد|ت\s*إ|ت\s*ا\b|ت\.إ|تا\b/i.test(
      text
    )
  ) {
    streamKey = 'ECONOMICS';
    officialStream = 'تسيير واقتصاد';
  }
  // Mathematics (رياضيات)
  else if (
    /رياضيات|رياضي(?!\s*تقني)|(?:\b|^)ر(?:\b|$)/i.test(textWithoutLevelPrefix) ||
    /^(?:ر|رياضيات)$/i.test(textWithoutLevelPrefix.trim())
  ) {
    streamKey = 'MATH';
    officialStream = 'رياضيات';
  }
  // Experimental Sciences (علوم تجريبية)
  else if (
    /علوم|تجريبيه|تجريبية|ع\s*ت|ع\.ت|عت/i.test(text) ||
    /^(?:ع\s*ت|عت)\b/i.test(textWithoutLevelPrefix)
  ) {
    streamKey = 'SCIENCES';
    officialStream = 'علوم تجريبية';
  }

  // 3. Detect Group Number
  // Look for group number inside the remaining text
  // Remove parenthesized stream names like "(رياضيات)", "(علوم تجريبية)", "(عام)"
  const cleanForGroup = textWithoutLevelPrefix.replace(/\([^)]*\)/g, ' ');
  const digits = cleanForGroup.match(/\b0*(\d+)\b/g);

  let groupNumber = 1; // Default to 1 (crucial rule: single group streams in Moumtaze omit the number)
  if (digits && digits.length > 0) {
    const candidate = parseInt(digits[digits.length - 1], 10);
    if (!isNaN(candidate) && candidate > 0 && candidate < 50) {
      groupNumber = candidate;
    }
  }

  // Determine Level Enum
  let level: GradeLevel = '2AS';
  if (levelNumber === 3) level = '3AS';
  else if (levelNumber === 2) level = '2AS';
  else if (streamKey === '1AS_ARTS') level = '1AS_ARTS';
  else level = '1AS_SCIENCE';

  // 4. Generate Canonical Name and Canonical Key
  let canonicalName = '';
  if (levelNumber === 1) {
    if (streamKey === '1AS_ARTS') {
      canonicalName = `1 ج م آداب ${groupNumber}`;
    } else {
      canonicalName = `1 ج م ع ت ${groupNumber}`;
    }
  } else {
    switch (streamKey) {
      case 'MATH':
        canonicalName = `${levelNumber} رياضيات ${groupNumber}`;
        break;
      case 'SCIENCES':
        canonicalName = `${levelNumber} ع ت ${groupNumber}`;
        break;
      case 'TECH_MATH':
        canonicalName = `${levelNumber} تقني رياضي ${groupNumber}`;
        break;
      case 'ECONOMICS':
        canonicalName = `${levelNumber} ت اقتصاد ${groupNumber}`;
        break;
      case 'LITERATURE':
        canonicalName = `${levelNumber} آف ${groupNumber}`;
        break;
      case 'LANGUAGES_ES':
        canonicalName = `${levelNumber} لغات (إسبانية) ${groupNumber}`;
        break;
      case 'LANGUAGES_DE':
        canonicalName = `${levelNumber} لغات (ألمانية) ${groupNumber}`;
        break;
      case 'LANGUAGES_IT':
        canonicalName = `${levelNumber} لغات (إيطالية) ${groupNumber}`;
        break;
      case 'LANGUAGES_RU':
        canonicalName = `${levelNumber} لغات (روسية) ${groupNumber}`;
        break;
      case 'LANGUAGES_GEN':
        canonicalName = `${levelNumber} لغات أجنبية ${groupNumber}`;
        break;
      case 'UNKNOWN':
        canonicalName = text.trim();
        break;
      default:
        canonicalName = `${levelNumber} ${officialStream} ${groupNumber}`;
        break;
    }
  }

  const canonicalKey = streamKey === 'UNKNOWN' ? text.trim().replace(/\s+/g, '_') : `${levelNumber}_${streamKey}_${groupNumber}`;

  return {
    raw,
    levelNumber,
    level,
    streamKey,
    officialStream,
    subSpecialty,
    groupNumber,
    canonicalName,
    canonicalKey,
  };
}

/**
 * Returns the unified canonical class name for any input name (e.g. "ثانية ثانوي رياضيات 1" -> "2 رياضيات 1")
 */
export function getCanonicalClassName(className: string): string {
  if (!className) return '';
  const parsed = parseAlgerianClass(className);
  return parsed ? parsed.canonicalName : className.trim();
}

/**
 * Legacy string normalizer retained for general text safety
 */
export function normalizeClassName(className: string): string {
  if (!className) return '';
  const parsed = parseAlgerianClass(className);
  if (parsed) return parsed.canonicalKey;

  return className
    .trim()
    .replace(/[\u064B-\u065F\u0670ـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/\b0+(\d+)\b/g, '$1')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Returns true if two class names represent the exact same pedagogical group,
 * whether one comes from Moumtaze (e.g. "2 رياضيات") and the other from Digitization
 * (e.g. "ثانية ثانوي رياضيات 1 (رياضيات)").
 */
export function isSameClass(classA: string, classB: string): boolean {
  if (!classA || !classB) return false;
  const a = classA.trim();
  const b = classB.trim();
  if (a === b) return true;

  const pA = parseAlgerianClass(a);
  const pB = parseAlgerianClass(b);

  if (pA && pB) {
    return pA.canonicalKey === pB.canonicalKey;
  }

  // Fallback to legacy string normalization if one or both cannot be parsed
  const normA = normalizeClassName(a);
  const normB = normalizeClassName(b);
  if (normA && normB && normA === normB) return true;

  return false;
}
