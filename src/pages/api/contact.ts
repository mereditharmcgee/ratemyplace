import type { APIContext } from 'astro';
import { getDB } from '../../lib/db';
import { getEnv, fireAndForget } from '../../lib/runtime';
import { generateIdFromEntropySize } from 'lucia';
import { verifyTurnstile } from '../../lib/turnstile';
import { getClientIP, checkRateLimit, buildRateLimitHeaders } from '../../lib/rateLimit';
import { validateContactForm } from '../../lib/validation';
import { sendContactConfirmationEmail, sendContactNotificationEmail } from '../../lib/email';

export async function POST(context: APIContext): Promise<Response> {
  // 1. Content-type guard
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

    // 2. Rate limit (3/hr per IP — SEC-07: Retry-After on 429; SEC-08: X-RateLimit-* on all responses)
    const rateLimitResult = await checkRateLimit(db, ip, 'contact', 3, 3600);
    if (!rateLimitResult.allowed) {
      const status = rateLimitResult.error ? 503 : 429;
      const message = rateLimitResult.error
        ? 'Service temporarily unavailable. Please try again in a few minutes.'
        : 'Too many submissions. Please wait before trying again.';
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: {
          'Content-Type': 'application/json',
          ...buildRateLimitHeaders(rateLimitResult, 3),
        }
      });
    }

    // 3. Body parse
    const formData = await context.request.formData();

    // 4. Turnstile
    const turnstileToken = formData.get('cf-turnstile-response') as string;
    const turnstileResult = await verifyTurnstile(
      turnstileToken,
      getEnv(context).TURNSTILE_SECRET_KEY,
      ip
    );
    if (!turnstileResult.success) {
      return new Response(JSON.stringify({ error: turnstileResult.error || 'Security check failed. Please try again.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 5. Validate (VAL-03)
    const name = (formData.get('name') as string || '').trim();
    const email = (formData.get('email') as string || '').trim();
    const category = (formData.get('category') as string || '').trim();
    const message = (formData.get('message') as string || '').trim();

    const errors = validateContactForm({ name, email, category, message });
    if (errors.length > 0) {
      return new Response(JSON.stringify({ error: 'Validation failed', details: errors }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 6. Insert
    const validCategories = ['general', 'privacy', 'support', 'landlord'];
    const safeCategory = validCategories.includes(category) ? category : 'general';

    const id = generateIdFromEntropySize(10);
    await db.prepare(`
      INSERT INTO contact_messages (id, name, email, category, message)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, name, email, safeCategory, message).run();

    // Phase 18 PERF-03: emails are fire-and-forgot — response returns before Resend resolves.
    // DB write (contact_messages INSERT) already committed above — DB-then-email ordering preserved.
    const resendApiKey = getEnv(context).RESEND_API_KEY;
    fireAndForget(context, sendContactConfirmationEmail(resendApiKey, email, name, safeCategory));

    const messagePreview = message.length > 200 ? message.slice(0, 200) + '...' : message;
    fireAndForget(context, sendContactNotificationEmail(resendApiKey, name, email, safeCategory, messagePreview));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...buildRateLimitHeaders(rateLimitResult, 3),
      }
    });
  } catch (error) {
    console.error('Contact form submission error:', error);
    return new Response(JSON.stringify({ error: 'Failed to submit your message. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
