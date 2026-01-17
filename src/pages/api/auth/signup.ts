import type { APIContext } from 'astro';
import { initializeLucia } from '../../../lib/auth';
import { getDB } from '../../../lib/db';
import { hashPassword } from '../../../lib/password';
import { generateIdFromEntropySize } from 'lucia';

export async function POST(context: APIContext): Promise<Response> {
  const formData = await context.request.formData();
  const email = formData.get('email');
  const password = formData.get('password');
  const confirmPassword = formData.get('confirmPassword');

  if (typeof email !== 'string' || typeof password !== 'string') {
    return new Response(JSON.stringify({ error: 'Invalid input' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (email.length < 3 || email.length > 255 || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Invalid email address' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (password.length < 6 || password.length > 255) {
    return new Response(JSON.stringify({ error: 'Password must be at least 6 characters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (password !== confirmPassword) {
    return new Response(JSON.stringify({ error: 'Passwords do not match' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);
    const lucia = initializeLucia(db);

    // Check if user already exists
    const existingUser = await db.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(email.toLowerCase()).first();

    if (existingUser) {
      return new Response(JSON.stringify({ error: 'Email already registered' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const userId = generateIdFromEntropySize(10);
    const hashedPassword = await hashPassword(password);

    await db.prepare(
      'INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)'
    ).bind(userId, email.toLowerCase(), hashedPassword).run();

    const session = await lucia.createSession(userId, {});
    const sessionCookie = lucia.createSessionCookie(session.id);

    context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Sign up error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
