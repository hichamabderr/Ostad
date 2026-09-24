# قواعـد الذكاء الاصطناعي (AI Agents Rules)

**الرجاء من أي AI Agent قراءة هذا الملف قبل إجراء أي تعديل على الكود.**

## 1. هوية التطبيق (Brand Identity)
* **اسم التطبيق:** معين الأستاذ (Mueen Al-Ostad).
* **النطاق المباشر (Production):** `https://ostady.vercel.app`.
* **الهدف:** مساعد رقمي شخصي ودفتر نصوص لأستاذ مادة العلوم الإسلامية (الطور الثانوي) في الجزائر.
* **الأسلوب:** رسمي، مهني، وموجز. يُمنع التكرار في التحية (مثلاً لا تستخدم "أستاذ أستاذ المادة").
* **شعار وأيقونة التطبيق (App Icon & Assets):**
  * **الرمز المعتمد:** ريشة قلم كلاسيكية عريقة منبثقة من كتاب مفتوح مع رذاذ الألوان المائية الزرقاء البترولية ولمسات الذهب الخافتة (يرمز للقلم والتدوين والعلوم الشرعية والبيداغوجيا).
  * **حزمة الأيقونات المعتمدة في `public/`:**
    * `pwa-192x192.png` & `pwa-512x512.png`: أيقونات PWA القياسية.
    * `pwa-maskable-512x512.png`: متوافقة مع قناع Android Adaptive Icons.
    * `apple-touch-icon.png`: أيقونة نظام iOS/iPadOS (180x180).
    * `favicon.ico`: أيقونة المتصفح متعددة الدقة (16, 32, 48).
    * `brand-logo-text.png`: الشعار الكامل مع كاليغرافي "مُعِين" لشاشات الترحيب والـ Hero.
  * **قواعد معيار الأمان للأيقونات (Safe Zone):** خلفية الأيقونة يجب أن تكون ممتدة بانسيابية بنسبة 100% باللون `#E1EDF6`؛ يُمنع منعاً باتاً تضمين ظلال ثلاثية الأبعاد (Drop Shadow)، أو حواف كروت (Bevels)، أو ورق مصور داخل ملفات الأيقونات. تظل كتلة الرسم داخل الدائرة المركزية 80% (Safe Zone).
  * **فصل الرمز عن الخط:** أيقونة المشغل (App Launcher) تحتوي على الرمز فقط دون كتابة نص، بينما يُستخدم النموذج المصحوب بخط "مُعِين" العربي لشاشات الإقلاع والترحيب (Splash & Hero).

## 2. التقنيات المعتمدة (Tech Stack)
* **الإطار:** Next.js 16.3.5 مع App Router وReact 19.
* **المسارات:** كل مساحة عمل لها مسار مستقل (`/dashboard` و`/classes`
  و`/attendance` و`/grades` و`/council` و`/sessions` و`/annual-distribution`
  و`/curriculum` و`/timetable` و`/lesson-preparation` و`/documents` و`/settings`).
  لا تستخدم `?tab` لتحديد الشاشة؛ تستخدم القراءة من المسار والتنقل عبر
  `usePathname`/`router.push`.
* **حدود RSC/Client:** اجعل `app/layout.tsx` وملفات المسارات الخفيفة
  Server Components افتراضياً. ضع `'use client'` فقط عند الحاجة إلى hooks أو
  أحداث المتصفح أو IndexedDB، ومرّر البيانات والأفعال عبر Props بحدود واضحة.
* **البناء والتطوير:** يستخدم المشروع Webpack عبر scripts الموجودة في
  `package.json`، بينما يبقى Turbopack متاحاً فقط عند اختيار تشغيله صراحةً.
* **التصميم:** Tailwind CSS v4.
* **الأيقونات:** `lucide-react`.
* **إدارة الحالة والتخزين:** تمثل الأنواع في `lib/storage.ts` عقد الواجهة،
  بينما تكون Supabase مصدر الحقيقة للكيانات المنظمة. يستخدم IndexedDB cache
  وoutbox للنسخة الجديدة فقط؛ لا تُرحّل لقطات `localStorage` السابقة. تمرر
  الحالة والأفعال عبر Props عند الحاجة، وتستخدم selectors typed من
  `lib/state-selectors.ts` للاشتقاقات الشائعة، ولا تنشئ snapshot سحابياً
  مونوليثياً أو متجراً ثانياً ينافس دورة المزامنة.
* **عقد سلامة البيانات (إلزامي):** Supabase هو المصدر الوحيد للحقيقة، وIndexedDB كاش محلي
  وطابور عمليات غير مؤكدة فقط. عند تحميل الحالة لا يُستبقى سجل محلي إلا إذا كان له عمل معلّق
  في الـ outbox (`pendingRecordIds`) وبدون شاهد حذف. الحذف مطلق: `sync_tombstones` تُقرأ عند
  التحميل، وتعديل سجل محذوف يُرفض بـ`SyncConflictError` ولا يُمسح شاهده، ولا يُسمح بتجاوزه إلا
  عبر `allowTombstoneOverride` الناتج عن قرار المستخدم في نافذة التعارض. تسجيل الخروج يفرّغ
  الطابور ثم يستدعي `purgeLocalUserData`، وكل مفاتيح IndexedDB الخاصة بالملفات مربوطة بالمالك
  (`sanad:pdf:<ownerId>:<unitId>`، `sanad:memoranda-outbox:<ownerId>:*`). الاختبارات الملزمة في
  `__tests__/data-safety.test.ts`، والتفاصيل في `STATE-INVENTORY.md` و`SYNC-REVIEW.md`.
* **المزامنة وطابور Delta:** الحالات المعتمدة هي `loading` أثناء التحميل، `ready` عند اتصال
  السحابة، و`sync-pending` و`sync-failed` و`conflict` للتغييرات قيد الإرسال
  أو الفشل أو التعارض، و`local-only` عند غياب الإعداد أو تعذر المخطط/الشبكة.
  تستخدم المزامنة طابور تحولات تفاضلي (Delta Mutations Outbox) يرسل فقط الكيانات المعدلة
  بشكل ذري مع revision وoperation id، مع دعم tombstones للحذف، وساعة مراجعة سحابية
  `cloudRevision` متزايدة، وإلغاء الصدى المتكرر (Echo Cancellation) عبر `sync_device_id`.
  روابط المذكرات السحابية الموقعة تستخدم صلاحية 7 أيام كاملة (604800 ثانية).
  رفض التحديث القديم أو التعارض نتيجة صريحة لا نجاحاً، ولا يُحذف outbox قبل الإقرار.
  يجب دائماً التأكد من أن كل جزئية وكيان وملف قابل للتغيير في المشروع متزامن
  مع Supabase أو مرتبط بطابور outbox واضح ومختبر؛ لا يجوز إضافة حالة محلية
  جديدة أو تخزين مستقل دون تحديد مصدر الحقيقة السحابي، عملية الرفع والحذف،
  وإعادة المحاولة والفشل والتعارض.
  يجب تحديث [`STATE-INVENTORY.md`](./STATE-INVENTORY.md) قبل وبعد كل تغيير
  يمس حالة أو بيانات قابلة للتعديل، مع توضيح مسار Supabase أو outbox وحالة
  Realtime وعمليات الحذف والتعارض والاختبارات المرتبطة.
* **Supabase:** المخطط العلائقي المملوك للمستخدم هو مصدر السحابة: `profiles`,
  `app_settings`, `classes`, `students`, `grades`, `sessions`, `attendance`,
  `session_behaviors`, `timetable_slots`, `lesson_progress`, `lesson_plans`,
  `custom_units`, و`file_assets`/`memoranda_files`، مع RLS وقيود العلاقات.
* **TypeScript:** إجباري في جميع الملفات.

## 3. محظورات قطعية (STRICTLY FORBIDDEN)
* 🚫 **لا تستخدم التنبيهات الافتراضية للمتصفح:** يُمنع منعاً باتاً استخدام `alert()` أو `prompt()` أو `confirm()`. استخدم نظام `showToast()` للإشعارات، واستخدم مكون `<ConfirmDialog>` لتأكيدات الحذف والتعديل.
* 🚫 **لا للوضع الليلي (No Dark Mode):** التطبيق مصمم ليكون مضيئاً (Light Mode) فقط. يُمنع إضافة أي صنف (class) يبدأ بـ `dark:`.
* 🚫 **لا للألوان المدمجة (No Hardcoded Hex Colors):** يُمنع كتابة ألوان Hex في المكونات مثل `bg-[#2E7D9B]`. يجب دائماً استخدام المتغيرات المعرفة في `globals.css` مثل `var(--primary)`.
* 🚫 **لا لعناوين الصفحات المكررة:** التطبيق مبني بنظام **Native Mobile First**. عنوان الصفحة يُعرض فقط في الشريط العلوي `TopHeaderSanad.tsx`. يُمنع إنشاء `div` وبداخله `h2` ليكون كعنوان رئيسي للمحتوى داخل المكونات (مثل صفحة الأقسام، دفتر النصوص، الخ). اكتفِ بأشرطة الأدوات (Toolbars) المدمجة والعملية.
* 🚫 **لا بيانات تجريبية في السحابة:** البيانات التجريبية المضمّنة للعرض
  ليست workspace حقيقية ولا يجوز ترحيلها إلى Supabase أو اعتبارها نسخة
  احتياطية للمستخدم. ابدأ مساحة المستخدم فارغة عند عدم وجود بيانات سحابية.
* ⚠️ **إعادة الضبط التجريبية destructive:** `reset_workspace` تحذف بيانات
  مساحة المستخدم وملفاتها السحابية نهائياً. لا تستدعها دون تأكيد صريح عبر
  `ConfirmDialog` وتحذير واضح؛ الميزة تجريبية وليست استعادة قابلة للعكس.

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
* عند تحديث الوثائق، حافظ على وصف المسارات المستقلة، حدود RSC/Client، المخطط
  العلائقي، IndexedDB cache/outbox، وحالات المزامنة وإعادة الضبط كما هي هنا.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
