import type { APIContext } from 'astro';
import { initializeLucia } from '../../../../lib/auth';
import { getDB } from '../../../../lib/db';
import { getEnv } from '../../../../lib/runtime';
import { generateIdFromEntropySize } from 'lucia';
import { signinErrorPath, takeOAuthReturn } from '../../../../lib/authRedirect';

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
  // Read and delete the return path first, so every exit below (success or error) both
  // honours it and leaves no cookie behind. Re-validated on the way out of the jar.
  const returnTo = takeOAuthReturn(context.cookies);

  const code = context.url.searchParams.get('code');
  const state = context.url.searchParams.get('state');
  const error = context.url.searchParams.get('error');

  // Handle OAuth errors
  if (error) {
    console.error('Google OAuth error:', error);
    return context.redirect(signinErrorPath('oauth_denied', returnTo));
  }

  // Verify state to prevent CSRF
  const storedState = context.cookies.get('oauth_state')?.value;
  if (!state || !storedState || state !== storedState) {
    console.error('OAuth state mismatch');
    return context.redirect(signinErrorPath('invalid_state', returnTo));
  }

  // Clear state cookie
  context.cookies.delete('oauth_state', { path: '/' });

  if (!code) {
    return context.redirect(signinErrorPath('no_code', returnTo));
  }

  const clientId = getEnv(context).GOOGLE_CLIENT_ID;
  const clientSecret = getEnv(context).GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('Google OAuth credentials not configured');
    return context.redirect(signinErrorPath('oauth_not_configured', returnTo));
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
      return context.redirect(signinErrorPath('token_exchange_failed', returnTo));
    }

    const tokens: GoogleTokenResponse = await tokenResponse.json();

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });

    if (!userInfoResponse.ok) {
      console.error('Failed to get user info');
      return context.redirect(signinErrorPath('userinfo_failed', returnTo));
    }

    const googleUser: GoogleUserInfo = await userInfoResponse.json();

    if (!googleUser.email) {
      return context.redirect(signinErrorPath('no_email', returnTo));
    }

    // Require a Google-verified email before trusting it. Google's userinfo can
    // return an unverified email (e.g. some Workspace configurations); without
    // this check, an identity asserting a victim's email would silently link to
    // — and take over — that victim's existing password account below, and would
    // seed new accounts with email_verified=1 they never proved.
    if (googleUser.email_verified !== true) {
      return context.redirect(signinErrorPath('unverified_email', returnTo));
    }

    const db = getDB(context);
    const lucia = initializeLucia(db);

    // Check if user exists with this Google ID
    let user = await db.prepare(
      'SELECT id, email FROM users WHERE google_id = ?'
    ).bind(googleUser.sub).first<{ id: string; email: string; google_id?: string | null }>();

    if (!user) {
      // Check if user exists with this email (link accounts)
      user = await db.prepare(
        'SELECT id, email, google_id FROM users WHERE email = ?'
      ).bind(googleUser.email.toLowerCase()).first<{ id: string; email: string; google_id: string | null }>();

      if (user) {
        // Check if account is already linked to a different Google account
        if (user.google_id && user.google_id !== googleUser.sub) {
          return context.redirect(signinErrorPath('account_conflict', returnTo));
        }
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

    return context.redirect(returnTo);
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    return context.redirect(signinErrorPath('oauth_failed', returnTo));
  }
}
