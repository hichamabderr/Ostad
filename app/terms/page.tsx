import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'شروط الاستخدام | معين الأستاذ',
  description: 'شروط استخدام تطبيق معين الأستاذ.',
};

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-[var(--surface)] px-5 py-10 text-[var(--text-primary)]" dir="rtl">
      <h1 className="text-2xl font-bold text-[var(--primary)]">شروط الاستخدام</h1>
      <p className="mt-4 text-sm leading-8">آخر تحديث: 19 سبتمبر 2026</p>
      <section className="mt-8 space-y-6 text-sm leading-8">
        <div>
          <h2 className="font-bold">الاستخدام المقبول</h2>
          <p>يستخدم التطبيق لإدارة العمل التربوي الشخصي. يلتزم المستخدم بإدخال بيانات يملك حق معالجتها والامتثال للقوانين والأنظمة المعمول بها.</p>
        </div>
        <div>
          <h2 className="font-bold">مسؤولية النسخ الاحتياطي</h2>
          <p>يوفر التطبيق أدوات تصدير ونسخ احتياطي، ويظل المستخدم مسؤولاً عن الاحتفاظ بنسخ مناسبة من ملفاته المهمة.</p>
        </div>
        <div>
          <h2 className="font-bold">الخدمة السحابية</h2>
          <p>قد تعتمد بعض الميزات على Supabase أو Google أو Netlify، وقد تتأثر بتوفر هذه الخدمات أو حدود خطتها المجانية.</p>
        </div>
        <div>
          <h2 className="font-bold">التعديلات</h2>
          <p>قد تتغير الميزات أو هذه الشروط عند الحاجة. استمرار استخدام التطبيق بعد نشر التعديلات يعني قبولها.</p>
        </div>
      </section>
    </main>
  );
}
