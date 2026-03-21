import type { APIContext } from 'astro';
import { getDB } from '../../lib/db';
import { generateIdFromEntropySize } from 'lucia';
import { verifyTurnstile } from '../../lib/turnstile';
import { getClientIP, checkRateLimit } from '../../lib/rateLimit';
import { sendContactConfirmationEmail, sendContactNotificationEmail } from '../../lib/email';

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
      return new Response(JSON.stringify({ error: turnstileResult.error || 'Security check failed. Please try again.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const db = getDB(runtime);
    const ip = getClientIP(context);

    // Rate limit: 3 submissions per hour per IP
    const rateLimitResult = await checkRateLimit(db, ip, 'contact', 3, 3600);
    if (!rateLimitResult.allowed) {
      return new Response(JSON.stringify({ error: 'Too many submissions. Please wait before trying again.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse and validate inputs
    const name = (formData.get('name') as string || '').trim();
    const email = (formData.get('email') as string || '').trim();
    const category = (formData.get('category') as string || '').trim();
    const message = (formData.get('message') as string || '').trim();

    if (!name || name.length < 2 || name.length > 100) {
      return new Response(JSON.stringify({ error: 'Name must be between 2 and 100 characters.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Please provide a valid email address.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!message || message.length < 10 || message.length > 3000) {
      return new Response(JSON.stringify({ error: 'Message must be between 10 and 3000 characters.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const validCategories = ['general', 'privacy', 'support', 'landlord'];
    const safeCategory = validCategories.includes(category) ? category : 'general';

    // Insert into D1
    const id = generateIdFromEntropySize(10);
    await db.prepare(`
      INSERT INTO contact_messages (id, name, email, category, message)
      VALUES (?, ?, ?, ?, ?)
    `).bind(id, name, email, safeCategory, message).run();

    // Send confirmation email to submitter (best-effort)
    const resendApiKey = runtime.env.RESEND_API_KEY;
    await sendContactConfirmationEmail(resendApiKey, email, name, safeCategory).catch((err) => {
      console.error('Failed to send contact confirmation email:', err);
    });

    // Send notification email to admin (best-effort)
    const messagePreview = message.length > 200 ? message.slice(0, 200) + '...' : message;
    await sendContactNotificationEmail(resendApiKey, name, email, safeCategory, messagePreview).catch((err) => {
      console.error('Failed to send contact notification email:', err);
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Contact form submission error:', error);
    return new Response(JSON.stringify({ error: 'Failed to submit your message. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
