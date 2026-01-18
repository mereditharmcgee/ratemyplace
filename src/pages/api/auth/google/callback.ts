import type { APIContext } from 'astro';
import { initializeLucia } from '../../../../lib/auth';
import { getDB } from '../../../../lib/db';
import { generateIdFromEntropySize } from 'lucia';

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
}

interface GoogleUserInfo {
  sub: string;          // Google's unique user ID
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export async function GET(context: APIContext): Promise<Response> {
  const code = context.url.searchParams.get('code');
  const state = context.url.searchParams.get('state');
  const error = context.url.searchParams.get('error');

  // Handle OAuth errors
  if (error) {
    console.error('Google OAuth error:', error);
    return context.redirect('/auth/signin?error=oauth_denied');
  }

  // Verify state to prevent CSRF
  const storedState = context.cookies.get('oauth_state')?.value;
  if (!state || !storedState || state !== storedState) {
    console.error('OAuth state mismatch');
    return context.redirect('/auth/signin?error=invalid_state');
  }

  // Clear state cookie
  context.cookies.delete('oauth_state', { path: '/' });

  if (!code) {
    return context.redirect('/auth/signin?error=no_code');
  }

  const runtime = (context.locals as any).runtime;
  const clientId = runtime?.env?.GOOGLE_CLIENT_ID;
  const clientSecret = runtime?.env?.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Google OAuth credentials not configured');
    return context.redirect('/auth/signin?error=oauth_not_configured');
  }

  try {
    // Exchange code for tokens
    const redirectUri = new URL('/api/auth/google/callback', context.url.origin).toString();

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      return context.redirect('/auth/signin?error=token_exchange_failed');
    }

    const tokens: GoogleTokenResponse = await tokenResponse.json();

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });

    if (!userInfoResponse.ok) {
      console.error('Failed to get user info');
      return context.redirect('/auth/signin?error=userinfo_failed');
    }

    const googleUser: GoogleUserInfo = await userInfoResponse.json();

    if (!googleUser.email) {
      return context.redirect('/auth/signin?error=no_email');
    }

    const db = getDB(runtime);
    const lucia = initializeLucia(db);

    // Check if user exists with this Google ID
    let user = await db.prepare(
      'SELECT id, email FROM users WHERE google_id = ?'
    ).bind(googleUser.sub).first<{ id: string; email: string }>();

    if (!user) {
      // Check if user exists with this email (link accounts)
      user = await db.prepare(
        'SELECT id, email, google_id FROM users WHERE email = ?'
      ).bind(googleUser.email.toLowerCase()).first<{ id: string; email: string; google_id: string | null }>();

      if (user) {
        // Link Google account to existing user
        await db.prepare(
          'UPDATE users SET google_id = ?, name = COALESCE(name, ?), avatar_url = COALESCE(avatar_url, ?), email_verified = 1 WHERE id = ?'
        ).bind(googleUser.sub, googleUser.name || null, googleUser.picture || null, user.id).run();
      } else {
        // Create new user
        const userId = generateIdFromEntropySize(10);

        await db.prepare(`
          INSERT INTO users (id, email, email_verified, google_id, name, avatar_url, hashed_password)
          VALUES (?, ?, 1, ?, ?, ?, NULL)
        `).bind(
          userId,
          googleUser.email.toLowerCase(),
          googleUser.sub,
          googleUser.name || null,
          googleUser.picture || null
        ).run();

        user = { id: userId, email: googleUser.email.toLowerCase() };
      }
    }

    // Create session
    const session = await lucia.createSession(user.id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);

    context.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

    return context.redirect('/');
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    return context.redirect('/auth/signin?error=oauth_failed');
  }
}
