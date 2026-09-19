import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية | معين الأستاذ',
  description: 'سياسة الخصوصية لتطبيق معين الأستاذ.',
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-[var(--surface)] px-5 py-10 text-[var(--text-primary)]" dir="rtl">
      <h1 className="text-2xl font-bold text-[var(--primary)]">سياسة الخصوصية</h1>
      <p className="mt-4 text-sm leading-8">آخر تحديث: 19 سبتمبر 2026</p>
      <section className="mt-8 space-y-6 text-sm leading-8">
        <div>
          <h2 className="font-bold">البيانات التي نعالجها</h2>
          <p>يعالج التطبيق بيانات الحساب الأساسية التي يوفرها Google، وبيانات العمل التربوي التي يدخلها الأستاذ مثل الأقسام والتلاميذ والدرجات والحضور.</p>
        </div>
        <div>
          <h2 className="font-bold">استخدام البيانات</h2>
          <p>تستخدم البيانات لتوفير دفتر الأستاذ، الحفظ السحابي، المزامنة بين أجهزتك، والتصدير. لا نبيع البيانات ولا نستخدمها للإعلانات الموجهة.</p>
        </div>
        <div>
          <h2 className="font-bold">التخزين والحماية</h2>
          <p>تخزن البيانات في Supabase مع عزل حسابات المستخدمين بسياسات RLS. تبقى بعض البيانات محلياً على جهازك لدعم العمل دون اتصال.</p>
        </div>
        <div>
          <h2 className="font-bold">حذف البيانات</h2>
          <p>يمكنك طلب حذف بياناتك أو التوقف عن استخدام التطبيق عبر التواصل مع مالك التطبيق. حذف الحساب يؤدي إلى حذف بياناته السحابية وفق إعدادات الخدمة.</p>
        </div>
        <div>
          <h2 className="font-bold">التواصل</h2>
          <p>للاستفسارات المتعلقة بالخصوصية، استخدم وسيلة التواصل المنشورة في صفحة التطبيق أو مستودعه الرسمي.</p>
        </div>
      </section>
    </main>
  );
}
