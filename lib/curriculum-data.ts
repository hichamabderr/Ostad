import { CurriculumUnit, GradeLevel } from './types';
import { enrichUnitsWithLocalMemoranda } from './local-memoranda-map';

export const OFFICIAL_LEVELS: {
  id: GradeLevel;
  name: string;
  subtitle: string;
  hoursTotal: number;
  unitsCount: number;
  weeklyHours: number;
}[] = [
  {
    id: '1AS_ARTS',
    name: 'السنة الأولى ثانوي — جذع مشترك آداب',
    subtitle: 'المنهاج والتدرج السنوي المعتمد (24 وحدة — 54 ساعة — ساعتان أسبوعياً)',
    hoursTotal: 54,
    unitsCount: 24,
    weeklyHours: 2
  },
  {
    id: '1AS_SCIENCE',
    name: 'السنة الأولى ثانوي — جذع مشترك علوم وتكنولوجيا',
    subtitle: 'المنهاج والتدرج السنوي المعتمد (15 وحدة — 27 ساعة — ساعة واحدة أسبوعياً)',
    hoursTotal: 27,
    unitsCount: 15,
    weeklyHours: 1
  },
  {
    id: '2AS',
    name: 'السنة الثانية ثانوي — جميع الشعب',
    subtitle: 'التوزيع السنوي والتدرج الرسمي (23 وحدة — 54 ساعة — ساعتان أسبوعياً)',
    hoursTotal: 54,
    unitsCount: 23,
    weeklyHours: 2
  },
  {
    id: '3AS',
    name: 'السنة الثالثة ثانوي (بكالوريا) — جميع الشعب',
    subtitle: 'التدرج السنوي الرسمي والتحضير للبكالوريا (24 وحدة — 54 ساعة — ساعتان أسبوعياً)',
    hoursTotal: 54,
    unitsCount: 24,
    weeklyHours: 2
  }
];

export function getWeeklyHours(level: GradeLevel | undefined): number {
  if (!level) return 2;
  return level === '1AS_SCIENCE' ? 1 : 2;
}

let curriculumCache: CurriculumUnit[] | null = null;
let levelCaches: Partial<Record<GradeLevel, CurriculumUnit[]>> = {};

export let OFFICIAL_CURRICULUM: CurriculumUnit[] = [];

export async function loadCurriculumByLevel(level: GradeLevel): Promise<CurriculumUnit[]> {
  if (levelCaches[level]) {
    return levelCaches[level]!;
  }
  
  let data: any;
  switch (level) {
    case '1AS_ARTS':
      data = await import('./data/curriculum-1as-arts.json');
      break;
    case '1AS_SCIENCE':
      data = await import('./data/curriculum-1as-science.json');
      break;
    case '2AS':
      data = await import('./data/curriculum-2as.json');
      break;
    case '3AS':
      data = await import('./data/curriculum-3as.json');
      break;
    default:
      return [];
  }
  
  const units = data.default || data;
  levelCaches[level] = units;
  
  const existingIds = new Set(OFFICIAL_CURRICULUM.map(u => u.id));
  for (const u of units) {
    if (!existingIds.has(u.id)) {
      OFFICIAL_CURRICULUM.push(u);
    }
  }
  
  return units;
}

export async function loadAllCurriculum(): Promise<CurriculumUnit[]> {
  if (curriculumCache) return curriculumCache;
  
  const results = await Promise.all(
    OFFICIAL_LEVELS.map(level => loadCurriculumByLevel(level.id))
  );
  
  const allUnits: CurriculumUnit[] = [];
  const ids = new Set<string>();
  for (const group of results) {
    for (const unit of group) {
      if (!ids.has(unit.id)) {
        ids.add(unit.id);
        allUnits.push(unit);
      }
    }
  }
  
  curriculumCache = allUnits;
  OFFICIAL_CURRICULUM = allUnits;
  return curriculumCache;
}

export function getAllCurriculum(): CurriculumUnit[] {
  return OFFICIAL_CURRICULUM;
}

export function getDefaultImplementationMechanisms(unit: Partial<CurriculumUnit>): string[] {
  const domain = unit.domain || '';
  const title = unit.title || '';

  if (domain.includes('القرآن') || domain.includes('الحديث') || title.includes('تجويد')) {
    return [
      'قراءة وتدبر السندات الشرعية المقررة برواية ورش عن نافع، وتحديد المعنى الإجمالي وشرح المفردات اللغوية الصعبة.',
      'طرح أسئلة سابرة وموجهة تسبر غور النصوص وتدفع المتعلمين لاستنباط الأحكام التكليفية والفوائد التربوية.',
      'تطبيق قواعد التلاوة والتجويد ومخارج الحروف مع تدريب المتعلمين على التلاوة الصحيحة الفردية والجماعية.',
      'استثمار التشجير والخرائط الذهنية لتفكيك المعاني وربط التوجيهات القرآنية والحديثية بالسلوك اليومي للمتعلم.'
    ];
  }

  if (domain.includes('الفقه') || title.includes('صلاة') || title.includes('حج') || title.includes('صيام') || title.includes('عبادات') || title.includes('معاملات') || title.includes('أسرة') || title.includes('حكم')) {
    return [
      'الانطلاق من وضعية مشكلة واقعية تنطلق من المعاملات اليومية أو النوازل الفقهية المعاصرة لبيان حكم المسألة.',
      'استخدام التشجير والمخططات التوضيحية لتفكيك الشروط والأركان والسنن والمبطلات وفق المعتمد في الفقه المالكي.',
      'إجراء تطبيقات عملية وتمثيل أدوار ومحاكاة للأحكام الفقهية وتصحيح الأخطاء الشائعة لدى المتعلمين.',
      'التمييز الدقيق بين الحكم التكليفي والوضعي واستخلاص مقاصد الشريعة في التيسير ورفع الحرج وجلب المصالح.'
    ];
  }

  if (domain.includes('العقيدة') || domain.includes('الفكر') || title.includes('إيمان') || title.includes('غلو') || title.includes('عقل') || title.includes('فطرة')) {
    return [
      'إدارة حوار فكري متزن ومناقشة عقلية مبنية على البراهين القرآنية والكونية لترسيخ العقيدة الصحيحة ورد الشبهات.',
      'ربط أدلة الدرس بظواهر الآفاق والأنفس لتعميق الإيمان والرقابة الذاتية والشعور بالمسؤولية الأخلاقية.',
      'تحليل مقولات فكرية معاصرة في ضوء وسطية الإسلام واعتداله، مع تفكيك جذور الغلو والتطرف والانحراف.',
      'صياغة خلاصات تركيبية يدونها المتعلم في كراسه تعبر عن تمثله لقيم التوحيد والاستقامة.'
    ];
  }

  // Seerah / Civilization / Ethics
  return [
    'استعراض محطات السيرة النبوية والمواقف التاريخية المشرقة وتحليل العبر والدلالات المستفادة منها.',
    'إبراز القدوة الحسنة للرسول ﷺ وصحابته الكرام في شتى مجالات الحياة للتمثل السلوكي والتربوي.',
    'توظيف جداول المقارنة والتسلسل الزمني لربط أسباب الوقائع بنتائجها واستخلاص السنن الربانية.',
    'تكليف المتعلمين بمهام استثمارية وأنشطة بحثية تبرز دور علماء الجزائر وإسهام الحضارة الإسلامية في خدمة الإنسانية.'
  ];
}

/**
 * Merges official curriculum units with teacher's custom units.
 * Guarantees that every unit ID is strictly unique.
 * Normalizes official fields: learningObjective, targetedResources, implementationMechanisms, teacherDirectives.
 */
export function getMergedCurriculumUnits(customUnits: CurriculumUnit[] = []): CurriculumUnit[] {
  const unitsMap = new Map<string, CurriculumUnit>();

  const normalizeUnit = (u: CurriculumUnit): CurriculumUnit => {
    const learningObjective = u.learningObjective || u.targetedCompetence || (u.learningObjectives && u.learningObjectives[0]) || '';
    const targetedResources = (u.targetedResources && u.targetedResources.length > 0)
      ? u.targetedResources
      : (u.learningObjectives || []);
    const teacherDirectives = (u.teacherDirectives && u.teacherDirectives.length > 0)
      ? u.teacherDirectives
      : (u.pedagogicalDirectives || []);
    const implementationMechanisms = (u.implementationMechanisms && u.implementationMechanisms.length > 0)
      ? u.implementationMechanisms
      : getDefaultImplementationMechanisms(u);

    return {
      ...u,
      learningObjective,
      targetedResources,
      teacherDirectives,
      pedagogicalDirectives: teacherDirectives,
      implementationMechanisms
    };
  };

  // 1. Add all official units
  for (const unit of OFFICIAL_CURRICULUM) {
    if (unit && unit.id) {
      unitsMap.set(unit.id, normalizeUnit(unit));
    }
  }

  // 2. Custom units override official units with the same ID, or append brand new units
  if (Array.isArray(customUnits)) {
    for (const custom of customUnits) {
      if (custom && custom.id) {
        unitsMap.set(custom.id, normalizeUnit(custom));
      }
    }
  }

  return enrichUnitsWithLocalMemoranda(Array.from(unitsMap.values()));
}
