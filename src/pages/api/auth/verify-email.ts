import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { validateVerificationToken } from '../../../lib/tokens';

export async function GET(context: APIContext): Promise<Response> {
  const token = context.url.searchParams.get('token');

  if (!token) {
    return context.redirect('/auth/signin?error=invalid_link');
  }

  try {
    const db = getDB(context);

    // Validate token
    const result = await validateVerificationToken(db, token);

    if (!result.valid) {
      const errorParam = result.reason === 'expired' ? 'link_expired' : 'invalid_link';
      return context.redirect(`/auth/signin?error=${errorParam}`);
    }

    // Mark email as verified and delete every verification token of the account, the used
    // one and the other live link a resend kept (tokens.ts), so neither works again.
    await db.batch([
      db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(result.userId),
      db.prepare('DELETE FROM verification_tokens WHERE user_id = ?').bind(result.userId),
    ]);

    // Redirect to success page
    return context.redirect('/email-verified');
  } catch (error) {
    console.error('Email verification error:', error);
    return context.redirect('/auth/signin?error=verification_failed');
  }
}
