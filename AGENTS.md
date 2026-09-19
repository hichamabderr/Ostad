# قواعـد الذكاء الاصطناعي (AI Agents Rules)

**الرجاء من أي AI Agent قراءة هذا الملف قبل إجراء أي تعديل على الكود.**

## 1. هوية التطبيق (Brand Identity)
* **اسم التطبيق:** معين الأستاذ (Mueen Al-Ostad).
* **الهدف:** مساعد رقمي شخصي ودفتر نصوص لأستاذ مادة العلوم الإسلامية (الطور الثانوي) في الجزائر.
* **الأسلوب:** رسمي، مهني، وموجز. يُمنع التكرار في التحية (مثلاً لا تستخدم "أستاذ أستاذ المادة").

## 2. التقنيات المعتمدة (Tech Stack)
* **الإطار:** Next.js 16.3.5 مع App Router وReact 19.
* **البناء والتطوير:** يستخدم المشروع Webpack عبر scripts الموجودة في
  `package.json`، بينما يبقى Turbopack متاحاً فقط عند اختيار تشغيله صراحةً.
* **التصميم:** Tailwind CSS v4.
* **الأيقونات:** `lucide-react`.
* **إدارة الحالة:** المصدر الموحد هو `AppState` في `lib/storage.ts`. تحفظ الحالة
  النصية محلياً في `localStorage`، بينما تحفظ ملفات PDF وطابور المزامنة في
  IndexedDB. عند توفر جلسة Supabase تُزامن الحالة الأساسية سحابياً، مع بقاء
  الوضع المحلي هو البديل الآمن. تمرر الحالة عبر Props باستخدام `state` و
  `onUpdateState`.
* **TypeScript:** إجباري في جميع الملفات.

## 3. محظورات قطعية (STRICTLY FORBIDDEN)
* 🚫 **لا تستخدم التنبيهات الافتراضية للمتصفح:** يُمنع منعاً باتاً استخدام `alert()` أو `prompt()` أو `confirm()`. استخدم نظام `showToast()` للإشعارات، واستخدم مكون `<ConfirmDialog>` لتأكيدات الحذف والتعديل.
* 🚫 **لا للوضع الليلي (No Dark Mode):** التطبيق مصمم ليكون مضيئاً (Light Mode) فقط. يُمنع إضافة أي صنف (class) يبدأ بـ `dark:`.
* 🚫 **لا للألوان المدمجة (No Hardcoded Hex Colors):** يُمنع كتابة ألوان Hex في المكونات مثل `bg-[#2E7D9B]`. يجب دائماً استخدام المتغيرات المعرفة في `globals.css` مثل `var(--primary)`.
* 🚫 **لا لعناوين الصفحات المكررة:** التطبيق مبني بنظام **Native Mobile First**. عنوان الصفحة يُعرض فقط في الشريط العلوي `TopHeaderSanad.tsx`. يُمنع إنشاء `div` وبداخله `h2` ليكون كعنوان رئيسي للمحتوى داخل المكونات (مثل صفحة الأقسام، دفتر النصوص، الخ). اكتفِ بأشرطة الأدوات (Toolbars) المدمجة والعملية.

## 4. منطق العمل (Business Logic)
* **ساعات العمل الأسبوعية:** مادة العلوم الإسلامية تُدرس ساعة واحدة لقسم (1 ج.م.علوم) وساعتين لباقي الأقسام (1 آداب، 2 و 3 ثانوي). تحقق من ذلك دوماً عبر دالة `getWeeklyHours()`.
* **الرقمنة والممتاز:** التطبيق يعتمد على استيراد ملفات Excel (بصيغتي الرقمنة والممتاز) لإدارة قوائم التلاميذ. احذر عند التعديل على مُحللات (Parsers) هذه الملفات.
* **الطباعة والتصدير:** يعتمد تصدير الوثائق على تحويل `HTML` إلى ملفات Word
  (`.doc`) باستخدام `exportToDoc` في `lib/utils.ts`، بينما تستخدم المذكرات
  المخصصة `lib/doc-exporter.ts`.

## 5. قواعد الأكواد
* حافظ على نظافة الـ JSX، لا تترك وسوماً غير مغلقة (`</div>` يتيمة).
* قبل إنهاء أي تغيير، شغّل `npm run lint` و`npm run test` عند ارتباطه بالسلوك،
  ثم `npm run build` للتأكد من عدم وجود أخطاء TypeScript أو JSX.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
