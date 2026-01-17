import type { APIContext } from 'astro';
import { initializeLucia } from '../../../lib/auth';
import { getDB } from '../../../lib/db';
import { verifyPassword } from '../../../lib/password';

export async function POST(context: APIContext): Promise<Response> {
  const formData = await context.request.formData();
  const email = formData.get('email');
  const password = formData.get('password');

  if (typeof email !== 'string' || typeof password !== 'string') {
    return new Response(JSON.stringify({ error: 'Invalid input' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (email.length < 3 || email.length > 255 || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (password.length < 6 || password.length > 255) {
    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);
    const lucia = initializeLucia(db);

    const result = await db.prepare(
      'SELECT id, hashed_password FROM users WHERE email = ?'
    ).bind(email.toLowerCase()).first<{ id: string; hashed_password: string }>();

    if (!result) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const validPassword = await verifyPassword(password, result.hashed_password);
    if (!validPassword) {
      return new Response(JSON.stringify({ error: 'Invalid email or password' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const session = await lucia.createSession(result.id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);

    context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Sign in error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
