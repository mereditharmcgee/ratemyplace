import { defineMiddleware } from 'astro:middleware';
import { initializeLucia } from './lib/auth';
import { getDB } from './lib/db';

export const onRequest = defineMiddleware(async (context, next) => {
  // Set default auth state
  context.locals.user = null;
  context.locals.session = null;

  try {
    const runtime = (context.locals as any).runtime;
    if (!runtime?.env?.DB) {
      return next();
    }

    const db = getDB(runtime);
    const lucia = initializeLucia(db);

    const sessionId = context.cookies.get(lucia.sessionCookieName)?.value ?? null;

    if (sessionId) {
      const { session, user } = await lucia.validateSession(sessionId);

      if (session && session.fresh) {
        const sessionCookie = lucia.createSessionCookie(session.id);
        context.cookies.set(sessionCookie.name, sessionCookie.value, {
          path: sessionCookie.attributes.path ?? '/',
          httpOnly: sessionCookie.attributes.httpOnly ?? true,
          secure: sessionCookie.attributes.secure ?? true,
          sameSite: sessionCookie.attributes.sameSite as 'lax' | 'strict' | 'none' ?? 'lax',
          maxAge: sessionCookie.attributes.maxAge,
        });
      }

      if (!session) {
        const blankCookie = lucia.createBlankSessionCookie();
        context.cookies.set(blankCookie.name, blankCookie.value, {
          path: blankCookie.attributes.path ?? '/',
          httpOnly: blankCookie.attributes.httpOnly ?? true,
          secure: blankCookie.attributes.secure ?? true,
          sameSite: blankCookie.attributes.sameSite as 'lax' | 'strict' | 'none' ?? 'lax',
          maxAge: 0,
        });
      }

      context.locals.session = session;
      context.locals.user = user;
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
  }

  const response = await next();

  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://maps.googleapis.com https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://*.googleapis.com https://*.gstatic.com",
      "frame-src https://challenges.cloudflare.com",
      "connect-src 'self' https://maps.googleapis.com https://places.googleapis.com https://challenges.cloudflare.com https://static.cloudflareinsights.com",
    ].join('; ')
  );

  return response;
});
