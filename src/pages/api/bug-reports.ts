import type { APIContext } from 'astro';
import { getDB } from '../../lib/db';
import { generateIdFromEntropySize } from 'lucia';
import { verifyTurnstile } from '../../lib/turnstile';
import { getClientIP } from '../../lib/rateLimit';

export async function POST(context: APIContext): Promise<Response> {
  try {
    const formData = await context.request.formData();

    // Verify Turnstile token
    const turnstileToken = formData.get('cf-turnstile-response') as string;
    const runtime = (context.locals as any).runtime;
    const turnstileResult = await verifyTurnstile(
      turnstileToken,
      runtime.env.TURNSTILE_SECRET_KEY,
      getClientIP(context)
    );
    if (!turnstileResult.success) {
      return new Response(JSON.stringify({ error: turnstileResult.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const email = formData.get('email') as string;
    const category = formData.get('category') as string;
    const description = formData.get('description') as string;
    const url = formData.get('url') as string;

    if (!description || description.trim().length < 10) {
      return new Response(JSON.stringify({ error: 'Please provide a description (at least 10 characters).' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (description.length > 5000) {
      return new Response(JSON.stringify({ error: 'Description is too long (max 5000 characters).' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const validCategories = ['bug', 'ui', 'performance', 'other'];
    const safeCategory = validCategories.includes(category) ? category : 'bug';

    const db = getDB(runtime);
    const id = generateIdFromEntropySize(10);
    const userId = context.locals.user?.id || null;

    await db.prepare(`
      INSERT INTO bug_reports (id, user_id, email, category, description, url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      userId,
      email || null,
      safeCategory,
      description.trim(),
      url || null
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Bug report submission error:', error);
    return new Response(JSON.stringify({ error: 'Failed to submit report. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
