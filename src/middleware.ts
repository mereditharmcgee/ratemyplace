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
      // No database available (e.g., during build), skip auth
      return next();
    }

    const db = getDB(runtime);
    const lucia = initializeLucia(db);

    const sessionId = context.cookies.get(lucia.sessionCookieName)?.value ?? null;

    if (sessionId) {
      const { session, user } = await lucia.validateSession(sessionId);

      if (session && session.fresh) {
        const sessionCookie = lucia.createSessionCookie(session.id);
        context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
      }

      if (!session) {
        const sessionCookie = lucia.createBlankSessionCookie();
        context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
      }

      context.locals.session = session;
      context.locals.user = user;
    }
  } catch (error) {
    // Log error but don't break the request
    console.error('Auth middleware error:', error);
  }

  return next();
});
