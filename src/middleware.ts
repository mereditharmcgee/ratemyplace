import { defineMiddleware } from 'astro:middleware';
import { initializeLucia } from './lib/auth';
import { getDB } from './lib/db';

export const onRequest = defineMiddleware(async (context, next) => {
  // Initialize auth
  let lucia;
  try {
    const runtime = (context.locals as any).runtime;
    const db = getDB(runtime);
    lucia = initializeLucia(db);
  } catch {
    // DB not available (e.g., during static build)
    context.locals.user = null;
    context.locals.session = null;
    return next();
  }

  const sessionId = context.cookies.get(lucia.sessionCookieName)?.value ?? null;

  if (!sessionId) {
    context.locals.user = null;
    context.locals.session = null;
    return next();
  }

  const { session, user } = await lucia.validateSession(sessionId);

  if (session && session.fresh) {
    const sessionCookie = lucia.createSessionCookie(session.id);
    context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
  }

  if (!session) {
    const sessionCookie = lucia.createBlankSessionCookie();
    context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
  }

  context.locals.user = user;
  context.locals.session = session;

  return next();
});
