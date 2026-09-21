import { NextResponse } from 'next/server';
import { getPublicAppUrl } from '@/lib/supabase/env';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = getPublicAppUrl() ?? getPublicOrigin(request, url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');
  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (!code) {
    return NextResponse.redirect(new URL('/?auth=error&reason=missing_code', origin));
  }

  // Keep the PKCE exchange in the browser so the browser client receives and
  // persists the session in the same storage used by AuthGate.
  const destination = new URL(safeNext, origin);
  destination.searchParams.set('code', code);
  return NextResponse.redirect(destination);
}

function getPublicOrigin(request: Request, fallbackUrl: URL): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (!forwardedHost) return fallbackUrl.origin;

  try {
    const origin = new URL(`${forwardedProto || fallbackUrl.protocol.replace(':', '')}://${forwardedHost}`);
    if (origin.protocol !== 'https:' && origin.protocol !== 'http:') return fallbackUrl.origin;
    return origin.origin;
  } catch {
    return fallbackUrl.origin;
  }
}
