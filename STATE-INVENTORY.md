# جرد الحالة والأجزاء القابلة للتغيير

هذه الوثيقة هي مرجع المراجعة قبل أي تغيير في تطبيق «معين الأستاذ». كل بيانات
المستخدم القابلة للحفظ يجب أن تملك مساراً واضحاً إلى Supabase، أو إلى
IndexedDB outbox عند العمل دون اتصال. حالات الواجهة المؤقتة لا تُرفع إلى
Supabase.

## مصادر الحالة

| المصدر | المحتوى | قاعدة التعامل |
| --- | --- | --- |
| `AppState` في `lib/storage.ts` | بيانات الأستاذ والأقسام والتلاميذ والتدريس والتقويم والإعدادات والملفات | مصدر عقد الواجهة؛ Supabase مصدر الحقيقة السحابي |
| `useCloudAppState` | الحالة الموحدة، حالة السحابة، أخطاء المزامنة والحفظ المحلي | مالك دورة التحميل والحفظ والمزامنة |
| `state-cache.ts` | نسخة محلية من `AppState` | Cache لا ينافس Supabase |
| `sync-outbox.ts` | عمليات upsert/delete للكيانات | لا تُحذف قبل الإقرار |
| `memoranda-outbox.ts` | عمليات رفع/حذف PDF | يضمن استمرارية الملفات دون اتصال |
| `localStorage` | معرّف الجهاز فقط | ممنوع تخزين بيانات المستخدم |

## كيانات الأعمال القابلة للتعديل

| الحالة | جدول/خدمة Supabase | الحذف/التعارض |
| --- | --- | --- |
| `profile` | `profiles` | metadata للمراجعة؛ الصورة تحتاج Storage/outbox؛ trigger لتحديث `sync_updated_at` |
| `calendarSettings`, `theme`, `dashboardStyle`, `sidebarCollapsed`, `onboardingDismissed`, `activeClassId`, `activeTrimester` | `app_settings` | revision وconflict؛ trigger خادمي موحد |
| `classes` | `classes` | tombstone |
| `students` | `students` | tombstone؛ الاستيراد الجماعي يمر عبر `import_roster_batch` مع outbox كضمان لاحق |
| `timetable` | `timetable_slots` | tombstone |
| `sessions` | `sessions` | tombstone؛ يرتبط بالحضور والسلوك |
| `attendance` | `attendance` | tombstone علائقي مستقل |
| `session behaviors` | `session_behaviors` | tombstone علائقي مستقل |
| `grades` | `grades` | revision؛ الحسابات المشتقة لا تصبح مصدراً ثانياً |
| `lessonProgress` | `lesson_progress` | tombstone |
| `customUnits` | `custom_units` | tombstone |
| `lessonPlans` | `lesson_plans` | tombstone |
| `dashboardTasks` | `dashboard_tasks` | tombstone |
| `unitPdfFiles` | `memoranda_files` + Storage bucket `memoranda` | outbox للرفع والحذف؛ `unit_key` للوحدات الرسمية؛ trigger لتحديث revision |
| `deletedRecordIds` | `sync_tombstones` عند الإرسال | يمنع resurrection من نسخة أقدم |

## حالات واجهة لا تُزامَن

تشمل: فتح النوافذ والحوارات، التبويبات، البحث والفلاتر، النصوص المؤقتة في
النماذج، رسائل النجاح والخطأ، العنصر الجاري حذفه، حالة تحليل ملف Excel،
حالة تحميل المنهج/PDF، وحالات `isOnline` وPWA install وdebounce وToast.

## مسارات التعديل التي يجب تدقيقها

1. CRUD الأقسام والتلاميذ والجدول والجلسات.
2. الحضور والسلوك والعلامات والحسابات.
3. الوحدات المخصصة والتقدم وخطط الدروس.
4. مهام لوحة التحكم.
5. الملف الشخصي والإعدادات والعطل والتفضيلات.
6. استيراد الرقمنة والممتاز والدمج والنسخة الاحتياطية.
7. رفع واستبدال وحذف PDF والطباعة والتصدير.
8. reset workspace والحذف العلائقي وإعادة المحاولة والتعارض.

## مصفوفة التغطية الحالية

| المجال | Supabase | outbox | Realtime | ملاحظة |
| --- | ---: | ---: | ---: | --- |
| الكيانات الدراسية والتدريسية | نعم | نعم | نعم | يحتاج اختبارات مجال أوسع |
| attendance/behavior/tasks | نعم | نعم | نعم | tombstones موجودة |
| profile/settings | نعم | نعم | نعم | يحتاج اختبار تعارض خاص |
| PDF metadata وStorage | نعم | نعم | metadata | يحتاج اختبار تكاملي |
| Excel imports | نعم | نعم | نعم عبر الصفوف الناتجة | RPC ذري `import_roster_batch` مع fallback إلى outbox |
| avatar binary | مسار Storage | نعم | لا | `avatars` bucket مع outbox محلي؛ يعاد إنشاء signed URL عند التحميل، وتدعم الإزالة outbox |
| retry/backoff | نعم | نعم | لا | محاولة مؤجلة بتزايد أسي حتى 5 دقائق مع حفظ attempts/nextAttemptAt |
| operation idempotency | operation id حتمي لكل revision | نعم | نعم | ledger `sync_operations` وRPC `claim_sync_operation` يمنعان تكرار العملية نفسها بعد انقطاع الاستجابة دون حجب تحديثات لاحقة |
| reset workspace | `reset_workspace` + RLS/FK | تنظيف outbox/cache بعد الإقرار | إعادة تحميل لاحقة | يحذف ملفات memoranda/avatar وسجل العمليات؛ و`dashboard_tasks` يملك trigger مزامنة واحداً |

## نتيجة التدقيق المباشر الأخير

- الجداول الأربعة عشر مفعّل عليها RLS، ولكل جدول سياسة owner، وثلاثة أعمدة
  `sync_revision`/`sync_updated_at`/`sync_device_id`.
- الجداول الأربعة عشر مضافة إلى `supabase_realtime`.
- تم تفعيل triggers خادمية موحدة لكل الكيانات التي تحتوي `revision`، وtrigger
  خاص لـ`profiles`، حتى لا تتغير الصفوف من مسار خادمي دون تحديث ساعة المزامنة.
- تم تصحيح تسجيل التعارض ليستعمل UUID السحابي بدلاً من المعرّف المحلي.
- تحذير Supabase الوحيد المتبقي هو Leaked Password Protection الخارجي
  المستبعد بطلب المستخدم.

## قاعدة التغيير

قبل تعديل أي جزء:

1. حدّد هل هو بيانات أعمال أم حالة واجهة مؤقتة.
2. حدّد مصدر الحقيقة وجدول Supabase أو سبب بقائه محلياً.
3. حدّد upsert/delete وoutbox وRealtime وconflict/tombstone.
4. أضف اختباراً أو تحققاً مناسباً.
5. حدّث هذه المصفوفة إذا تغيّر نطاق التغطية.
