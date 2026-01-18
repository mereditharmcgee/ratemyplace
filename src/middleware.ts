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

  return next();
});
