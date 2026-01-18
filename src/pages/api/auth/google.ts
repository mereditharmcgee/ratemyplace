import type { APIContext } from 'astro';

// Initiates Google OAuth flow
export async function GET(context: APIContext): Promise<Response> {
  const runtime = (context.locals as any).runtime;
  const clientId = runtime?.env?.GOOGLE_CLIENT_ID;

  if (!clientId) {
    console.error('GOOGLE_CLIENT_ID not configured');
    return context.redirect('/auth/signin?error=oauth_not_configured');
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
