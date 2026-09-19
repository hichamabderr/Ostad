'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F1EA]">
      <div className="text-center p-8 bg-white rounded-3xl border border-[#E2E5E2] shadow-md max-w-md w-full mx-4">
        <h1 className="text-3xl font-bold text-[#0D6547] mb-4">خطأ غير متوقع</h1>
        <p className="text-xl text-[#171A18] mb-6">حدث خطأ أثناء معالجة طلبك.</p>
        <button 
          onClick={() => reset()}
          className="px-6 py-3 bg-[#0D6547] text-white rounded-xl hover:bg-[#0A533A] transition-colors font-bold inline-block"
        >
          حاول مرة أخرى
        </button>
      </div>
    </div>
  );
}
