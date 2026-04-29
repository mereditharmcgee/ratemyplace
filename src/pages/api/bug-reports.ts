import type { APIContext } from 'astro';
import { getDB } from '../../lib/db';
import { getEnv } from '../../lib/runtime';
import { generateIdFromEntropySize } from 'lucia';
import { verifyTurnstile } from '../../lib/turnstile';
import { getClientIP, checkRateLimit, buildRateLimitHeaders } from '../../lib/rateLimit';
import { validateBugReport } from '../../lib/validation';

export async function POST(context: APIContext): Promise<Response> {
  // 1. Content-type guard — MUST come before any body parse (formData throws TypeError on wrong type)
  const contentType = context.request.headers.get('content-type') || '';
  const isForm = contentType.includes('multipart/form-data') ||
                 contentType.includes('application/x-www-form-urlencoded');
  if (!isForm) {
    return new Response(JSON.stringify({ error: 'Unsupported Media Type' }), {
      status: 415,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB(context);
    const ip = getClientIP(context);

    // 2. Rate limit: 5 / hour per IP (SEC-04)
    const rateLimit = await checkRateLimit(db, ip, 'bug-report', 5, 3600);
    if (!rateLimit.allowed) {
      const status = rateLimit.error ? 503 : 429;
      const message = rateLimit.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many bug reports. Please try again later.';
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: {
          'Content-Type': 'application/json',
          ...buildRateLimitHeaders(rateLimit, 5),
        }
      });
    }

    // 3. Body parse — safe now that content-type is confirmed
    const formData = await context.request.formData();

    // 4. Turnstile — paid call, gated behind rate limit
    const turnstileToken = formData.get('cf-turnstile-response') as string;
    const turnstileResult = await verifyTurnstile(
      turnstileToken,
      getEnv(context).TURNSTILE_SECRET_KEY,
      ip
    );
    if (!turnstileResult.success) {
      return new Response(JSON.stringify({ error: turnstileResult.error || 'Security check failed.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 5. Validate (VAL-02)
    const email = formData.get('email') as string | null;
    const category = formData.get('category') as string | null;
    const description = formData.get('description') as string | null;
    const url = formData.get('url') as string | null;

    const errors = validateBugReport({
      email: email || undefined,
      category: category || undefined,
      description: description || undefined,
      url: url || undefined,
    });
    if (errors.length > 0) {
      return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 6. Sanitize + insert
    const validCategories = ['bug', 'ui', 'performance', 'other'];
    const safeCategory = (category && validCategories.includes(category)) ? category : 'bug';

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
      (description || '').trim(),
      url || null
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...buildRateLimitHeaders(rateLimit, 5),
      }
    });
  } catch (error) {
    console.error('Bug report submission error:', error);
    return new Response(JSON.stringify({ error: 'Failed to submit report. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
