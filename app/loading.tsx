export default function Loading() {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[var(--bg-page)]"
      dir="rtl"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
        <p className="text-sm font-bold text-[var(--text-secondary)]">جارٍ التحميل...</p>
      </div>
    </main>
  );
}
