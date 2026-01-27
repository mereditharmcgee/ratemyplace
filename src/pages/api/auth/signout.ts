import type { APIContext } from 'astro';
import { initializeLucia } from '../../../lib/auth';
import { getDB } from '../../../lib/db';

export async function POST(context: APIContext): Promise<Response> {
  if (!context.locals.session) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);
    const lucia = initializeLucia(db);

    await lucia.invalidateSession(context.locals.session.id);
    const sessionCookie = lucia.createBlankSessionCookie();

    context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

    // Redirect to home page
    return new Response(null, {
      status: 302,
      headers: { 'Location': '/' }
    });
  } catch (error) {
    console.error('Sign out error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
