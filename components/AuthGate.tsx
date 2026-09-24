'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { getSupabaseEnv } from '@/lib/supabase/env';
import { getCachedAuthUser, initializeAuthState, subscribeToAuthState } from '@/lib/supabase/auth-state';
import { showToast } from '@/components/Toast';
import { clearAppStateCache } from '@/lib/state-cache';
import type { User } from '@supabase/supabase-js';

interface AuthGateProps {
  children: (user: User | null, onSignOut: () => void) => React.ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const cachedUser = getCachedAuthUser();
  const [user, setUser] = useState<User | null>(cachedUser ?? null);
  const configured = Boolean(getSupabaseEnv());
  const [loading, setLoading] = useState(configured && cachedUser === undefined);

  useEffect(() => {
    let active = true;
    const callbackCode = new URLSearchParams(window.location.search).get('code');
    if (callbackCode && window.location.pathname === '/') {
      const callbackUrl = new URL('/auth/callback', window.location.origin);
      callbackUrl.searchParams.set('code', callbackCode);
      const next = new URLSearchParams(window.location.search).get('next');
      if (next) callbackUrl.searchParams.set('next', next);
      window.location.replace(callbackUrl.toString());
      return () => {
        active = false;
      };
    }

    const unsubscribe = subscribeToAuthState((nextUser) => {
      if (!active) return;
      setUser(nextUser);
      setLoading(false);
    });
    void initializeAuthState()
      .then((nextUser) => {
        if (!active) return;
        setUser(nextUser);
        setLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Supabase session lookup failed:', error);
        setLoading(false);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (!configured) return children(null, () => {});
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--surface)]" dir="rtl">
        <p className="text-sm font-bold text-[var(--muted-foreground)]">جارٍ التحقق من جلسة الدخول...</p>
      </div>
    );
  }

  if (!user) return <AuthLanding />;
  return (
    children(user, () => void supabaseSignOut())
  );
}

async function supabaseSignOut() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getUser();
    if (data?.user?.id) {
      await clearAppStateCache(data.user.id);
    } else {
      await clearAppStateCache();
    }
  } catch {
    await clearAppStateCache();
  }
  const { error } = await supabase.auth.signOut();
  if (error) console.error('Supabase sign-out failed:', error);
}

function AuthLanding() {
  const [showLogin, setShowLogin] = useState(false);

  if (showLogin) return <LoginPanel onBack={() => setShowLogin(false)} />;

  return (
    <main className="min-h-screen bg-[var(--bg-page)] px-4 py-10" dir="rtl">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-[var(--border-default)] bg-white shadow-sm md:grid-cols-[1.1fr_0.9fr]">
          <div className="bg-[var(--accent-navy)] p-8 text-white sm:p-12">
            <p className="text-sm font-bold text-[var(--accent-gold)]">مساعد أستاذ العلوم الإسلامية</p>
            <h1 className="mt-4 text-3xl font-black leading-tight sm:text-4xl">معين الأستاذ</h1>
            <p className="mt-5 max-w-lg text-sm leading-8 text-slate-200">
              دفتر رقمي منظم لإدارة الأقسام، الحضور، النقاط، دفتر النصوص، والتخطيط السنوي في مكان واحد.
            </p>
            <button
              type="button"
              onClick={() => setShowLogin(true)}
              className="mt-8 rounded-xl bg-[var(--primary)] px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-[var(--primary-hover)]"
            >
              الدخول إلى التطبيق
            </button>
          </div>
          <div className="flex items-center p-8 sm:p-12">
            <div>
              <h2 className="text-xl font-black text-[var(--text-primary)]">كل ما تحتاجه في يومك الدراسي</h2>
              <ul className="mt-5 space-y-3 text-sm leading-7 text-[var(--text-secondary)]">
                <li>• تنظيم الأقسام وقوائم التلاميذ</li>
                <li>• متابعة الحضور والتقويم والنقاط</li>
                <li>• إعداد المذكرات والوثائق بسرعة</li>
                <li>• حفظ نسخة احتياطية محلية من بياناتك</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-x-5 gap-y-2 pb-2 text-xs text-[var(--text-secondary)]">
        <Link className="transition-colors hover:text-[var(--primary)]" href="/privacy">سياسة الخصوصية</Link>
        <Link className="transition-colors hover:text-[var(--primary)]" href="/terms">شروط الاستخدام</Link>
        <span>© {new Date().getFullYear()} معين الأستاذ</span>
      </footer>
    </main>
  );
}

function LoginPanel({ onBack }: { onBack: () => void }) {
  const [errorMessage, setErrorMessage] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('auth') === 'error'
      ? 'تعذر إكمال تسجيل الدخول. أعد المحاولة بعد قليل.'
      : null;
  });
  const [working, setWorking] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  const signIn = async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    setWorking(true);
    setErrorMessage(null);
    try {
      const next = `${window.location.pathname}${window.location.search}`;
      // Always use the origin currently serving the app. This prevents a
      // production deployment from inheriting a localhost callback URL.
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
        },
      });
      if (error) throw error;
    } catch (error) {
      const message = 'تعذر بدء تسجيل الدخول. أعد المحاولة بعد قليل.';
      console.error('Google sign-in failed:', error);
      setErrorMessage(message);
      showToast(message, 'error');
      setWorking(false);
    }
  };

  const signInWithEmail = async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !email.trim()) return;

    setWorking(true);
    setErrorMessage(null);
    try {
      const next = `${window.location.pathname}${window.location.search}`;
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setEmailSent(true);
    } catch (error) {
      const message = 'تعذر إرسال رابط الدخول. تحقق من البريد وأعد المحاولة.';
      console.error('Email sign-in failed:', error);
      setErrorMessage(message);
      showToast(message, 'error');
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--bg-page)] px-4 py-8" dir="rtl">
      <section className="w-full max-w-md rounded-3xl border border-[var(--border)] bg-white p-8 text-center shadow-sm">
        <button type="button" onClick={onBack} className="text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--primary)]">العودة إلى التعريف</button>
        <h1 className="mt-5 text-2xl font-bold text-[var(--primary)]">تسجيل الدخول</h1>
        <p className="mt-3 text-sm text-[var(--muted-foreground)]">
          اختر طريقة الدخول المناسبة للمتابعة إلى دفتر الأستاذ.
        </p>
        {errorMessage && (
          <p role="alert" className="mt-4 rounded-lg bg-[var(--danger)]/10 px-3 py-2 text-xs font-bold text-[var(--danger)]">
            {errorMessage}
          </p>
        )}
        <button
          type="button"
          disabled={working}
          onClick={signIn}
          className="mt-8 min-h-12 w-full rounded-xl bg-[var(--primary)] px-4 py-3 font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {working ? 'جارٍ فتح تسجيل الدخول...' : 'الدخول باستخدام Google'}
        </button>
        <div className="my-5 flex items-center gap-3 text-xs text-[var(--text-tertiary)]">
          <span className="h-px flex-1 bg-[var(--border-default)]" />
          <span>أو بالبريد الإلكتروني</span>
          <span className="h-px flex-1 bg-[var(--border-default)]" />
        </div>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="البريد الإلكتروني"
          autoComplete="email"
          className="min-h-12 w-full rounded-xl border border-[var(--border-default)] px-4 text-sm outline-none transition-colors focus:border-[var(--primary)]"
          dir="ltr"
        />
        <button
          type="button"
          disabled={working || !email.trim()}
          onClick={() => void signInWithEmail()}
          className="mt-3 min-h-12 w-full rounded-xl border border-[var(--primary)] px-4 py-3 font-bold text-[var(--primary)] transition-colors hover:bg-[var(--primary-soft)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {working ? 'جارٍ الإرسال...' : 'إرسال رابط الدخول'}
        </button>
        {emailSent && (
          <p className="mt-3 rounded-lg bg-[var(--success-soft)] px-3 py-2 text-xs font-bold text-[var(--success)]">
            تم إرسال رابط الدخول إلى بريدك الإلكتروني.
          </p>
        )}
      </section>
    </main>
  );
}
