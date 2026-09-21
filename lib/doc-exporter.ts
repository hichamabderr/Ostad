import { CurriculumUnit, TeacherProfile } from './types';
import { OFFICIAL_LEVELS } from './curriculum-data';

/**
 * Generates and downloads a rich, beautifully formatted Microsoft Word (.doc) document
 * compliant with the Algerian Ministry of National Education pedagogical standards.
 */
export function exportUnitToWordDoc(unit: CurriculumUnit, teacherProfile?: TeacherProfile): void {
  const levelObj = OFFICIAL_LEVELS.find(l => l.id === unit.level);
  const levelName = levelObj?.name || (unit.level === '1AS_SCIENCE' ? 'السنة الأولى ثانوي — جذع مشترك علوم وتكنولوجيا' : unit.level);
  const teacherName = teacherProfile?.name || 'أستاذ المادة';
  const schoolName = teacherProfile?.schoolName || 'ثانوية التعليم الثانوي';
  const academicYear = teacherProfile?.academicYear || '2025 / 2026 م';

  const learningObjective = unit.learningObjective || unit.targetedCompetence || '';
  const targetedResources = unit.targetedResources || unit.learningObjectives || [];
  const implementationMechanisms = unit.implementationMechanisms || [];
  const teacherDirectives = unit.teacherDirectives || unit.pedagogicalDirectives || [];
  const referenceTexts = unit.referenceTexts || [];
  const indicators = unit.indicators || [];

  const htmlContent = `
<html xmlns:o='urn:schemas-microsoft-com:office:office'
      xmlns:w='urn:schemas-microsoft-com:office:word'
      xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset="utf-8">
  <title>مذكرة ${unit.title}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page {
      size: A4 portrait;
      margin: 7mm 9mm 9mm 9mm;
    }
    body {
      direction: rtl;
      text-align: right;
      unicode-bidi: embed;
      mso-bidi-font-family: 'Amiri';
      font-family: 'Amiri', 'Traditional Arabic', 'Simplified Arabic', Tahoma, Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.3;
      color: #0D2C3B;
      background-color: #ffffff;
    }
    .official-header {
      text-align: center;
      margin-bottom: 5px;
      border-bottom: 1px solid #0D2C3B;
      padding-bottom: 3px;
    }
    .official-header h1 {
      font-size: 13pt;
      font-weight: bold;
      color: #0D2C3B;
      margin: 0 0 4px 0;
    }
    .official-header h2 {
      font-size: 11pt;
      color: #0E7C61;
      margin: 0 0 4px 0;
    }
    .official-header h3 {
      font-size: 10pt;
      color: #555555;
      margin: 0;
    }
    .meta-table {
      width: 100%;
      border-collapse: collapse;
      direction: rtl;
      mso-table-dir: rtl;
      margin-bottom: 6px;
      table-layout: fixed;
    }
    table { direction: rtl; mso-table-dir: rtl; }
    tr { direction: rtl; }
    .meta-table td, .meta-table th {
      border: 1px solid #0E7C61;
      padding: 4px 6px;
      font-size: 9pt;
      direction: rtl;
      unicode-bidi: embed;
      overflow-wrap: anywhere;
    }
    .meta-table th {
      background-color: #E8F4F0;
      color: #0D2C3B;
      font-weight: bold;
      width: 25%;
    }
    .meta-table td {
      background-color: #FFFFFF;
      color: #111111;
    }
    .section-box {
      margin-bottom: 6px;
      border: 1px solid #D5DFDC;
      background-color: #FAFCFB;
      border-radius: 6px;
      overflow: hidden;
    }
    .section-title {
      background-color: #0E7C61;
      color: #FFFFFF;
      padding: 4px 8px;
      font-size: 10pt;
      font-weight: bold;
      margin: 0;
    }
    .section-body {
      padding: 5px 8px;
    }
    .objective-box {
      background-color: #F4F7F6;
      border-right: 5px solid #0E7C61;
      padding: 6px 8px;
      font-size: 10pt;
      font-weight: bold;
      color: #0D2C3B;
      line-height: 1.7;
    }
    .quran-box {
      background-color: #FFFDF7;
      border: 1px solid #D9B44A;
      border-right: 5px solid #D9B44A;
      padding: 5px 8px;
      margin-bottom: 5px;
      font-size: 10pt;
      line-height: 1.45;
      color: #1A3B2F;
      border-radius: 4px;
    }
    .item-list {
      margin: 6px 0;
      padding-right: 22px;
    }
    .item-list li {
      margin-bottom: 4px;
      line-height: 1.35;
    }
    .directive-box {
      background-color: #F0F7FF;
      border-right: 4px solid #2B6CB0;
      padding: 5px 8px;
      margin-bottom: 4px;
      color: #1A365D;
    }
    .footer {
      text-align: center;
      font-size: 8pt;
      color: #718096;
      border-top: 1px solid #E2E8F0;
      padding-top: 4px;
      margin-top: 6px;
    }
  </style>
</head>
<body dir="rtl">

  <div class="official-header">
    <h1>مادة العلوم الإسلامية</h1>
    <h3>بطاقة المذكرة البيداغوجية</h3>
  </div>

  <!-- Identification Table -->
  <table class="meta-table" dir="rtl">
    <tr>
      <th>المستوى والشعبة</th>
      <td>${levelName}</td>
      <th>الأستاذ(ة)</th>
      <td>${teacherName}</td>
    </tr>
    <tr>
      <th>الميدان التعليمي</th>
      <td>${unit.domain}</td>
      <th>المؤسسة التربوية</th>
      <td>${schoolName}</td>
    </tr>
    <tr>
      <th>المقطع التعلمي</th>
      <td>${unit.sectionName}</td>
      <th>السنة الدراسية</th>
      <td>${academicYear}</td>
    </tr>
    <tr>
      <th>الوحدة التعليمية رقم (${unit.unitNumber})</th>
      <td style="font-weight: bold; color: #0E7C61;">${unit.title}</td>
      <th>الحجم الساعي / الزمن</th>
      <td style="font-weight: bold;">${unit.hourlyVolume} سا (${unit.level === '1AS_SCIENCE' ? 'ساعة واحدة أسبوعياً' : 'ساعتان أسبوعياً'})</td>
    </tr>
  </table>

  <!-- 1. Learning Objective -->
  <div class="section-box">
    <div class="section-title">1. الهدف التعلمي (وفق التدرجات السنوية ومؤشرات الأداء الرسمية):</div>
    <div class="section-body">
      <div class="objective-box">
        ${learningObjective || 'يتعرف على المفاهيم الأساسية والأحكام الشرعية للوحدة ويتمثل قيمها سلوكياً وأخلاقياً.'}
      </div>
    </div>
  </div>

  <!-- 2. Holy Texts & References -->
  ${referenceTexts.length > 0 ? `
  <div class="section-box">
    <div class="section-title">2. السندات والنصوص الشرعية المؤطرة للوحدة:</div>
    <div class="section-body">
      ${referenceTexts.map(txt => `<div class="quran-box">${txt.replace(/\n/g, '<br/>')}</div>`).join('')}
    </div>
  </div>
  ` : ''}

  <!-- 3. Targeted Resources (Conceptual Elements) -->
  <div class="section-box">
    <div class="section-title">3. الموارد المستهدفة (العناصر المفاهيمية وبناء التعلمات):</div>
    <div class="section-body">
      <ol class="item-list">
        ${targetedResources.map(res => `<li>${res}</li>`).join('')}
      </ol>
    </div>
  </div>

  <!-- 4. Implementation Mechanisms -->
  <div class="section-box">
    <div class="section-title">4. آلية تنفيذ التعلمات (خطوات الإنجاز والأنشطة البيداغوجية):</div>
    <div class="section-body">
      <ul class="item-list">
        ${implementationMechanisms.map(mech => `<li>${mech}</li>`).join('')}
      </ul>
    </div>
  </div>

  <!-- 5. Teacher Directives -->
  ${teacherDirectives.length > 0 ? `
  <div class="section-box">
    <div class="section-title">5. توجيهات خاصة بالأستاذ (ليست عناصر مفاهيمية):</div>
    <div class="section-body">
      ${teacherDirectives.map(dir => `<div class="directive-box">• ${dir}</div>`).join('')}
    </div>
  </div>
  ` : ''}

  <!-- 6. Performance & Evaluation Indicators -->
  ${indicators.length > 0 ? `
  <div class="section-box">
    <div class="section-title">6. مؤشرات الأداء والتقويم:</div>
    <div class="section-body">
      <ul class="item-list">
        ${indicators.map(ind => `<li>${ind}</li>`).join('')}
      </ul>
    </div>
  </div>
  ` : ''}

  <!-- Footer -->
  <div class="footer">
    تم استخراج هذه المذكرة البيداغوجية الرسمية عبر منصة <strong>سند الأستاذ — العلوم الإسلامية</strong> بالتعليم الثانوي بالجزائر.
  </div>

</body>
</html>
`;

  // Create Word document Blob
  const blob = new Blob(['\ufeff' + htmlContent], {
    type: 'application/msword;charset=utf-8'
  });

  // Generate clean filename
  const cleanTitle = unit.title.replace(/[\/\\:*?"<>|]/g, '-').trim();
  const fileName = `مذكرة_${cleanTitle}_${unit.level}.doc`;

  // Trigger download
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
