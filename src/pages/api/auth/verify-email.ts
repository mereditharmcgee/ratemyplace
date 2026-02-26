import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { validateVerificationToken, deleteVerificationToken } from '../../../lib/tokens';

export async function GET(context: APIContext): Promise<Response> {
  const token = context.url.searchParams.get('token');

  if (!token) {
    return context.redirect('/auth/signin?error=invalid_link');
  }

  try {
    const db = getDB((context.locals as any).runtime);

    // Validate token
    const result = await validateVerificationToken(db, token);

    if (!result.valid) {
      const errorParam = result.reason === 'expired' ? 'link_expired' : 'invalid_link';
      return context.redirect(`/auth/signin?error=${errorParam}`);
    }

    // Mark email as verified
    await db.prepare(
      'UPDATE users SET email_verified = 1 WHERE id = ?'
    ).bind(result.userId).run();

    // Delete used token (single-use)
    await deleteVerificationToken(db, token);

    // Redirect to success page
    return context.redirect('/email-verified');
  } catch (error) {
    console.error('Email verification error:', error);
    return context.redirect('/auth/signin?error=verification_failed');
  }
}
