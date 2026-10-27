import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/runtime';
import { rememberOAuthReturn, safeRedirectPath, signinErrorPath } from '../../../lib/authRedirect';

// Initiates Google OAuth flow
export async function GET(context: APIContext): Promise<Response> {
  const clientId = getEnv(context).GOOGLE_CLIENT_ID;

  if (!clientId) {
    console.error('GOOGLE_CLIENT_ID not configured');
    return context.redirect(
      signinErrorPath('oauth_not_configured', safeRedirectPath(context.url.searchParams.get('redirect')))
    );
  }

  // Generate state for CSRF protection
  const state = crypto.randomUUID();

  // Store state in cookie (short-lived)
  context.cookies.set('oauth_state', state, {
    path: '/',
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    maxAge: 60 * 10 // 10 minutes
  });

  // Where to land after the round trip. Its own cookie, scoped to /api/auth/google so only
  // the callback sees it, leaves oauth_state and its comparison exactly as they were. An
  // unsafe or missing path clears any stale one instead.
  rememberOAuthReturn(context.cookies, context.url.searchParams.get('redirect'), import.meta.env.PROD);

  // Build Google OAuth URL
  const redirectUri = new URL('/api/auth/google/callback', context.url.origin).toString();

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  return context.redirect(authUrl);
}
