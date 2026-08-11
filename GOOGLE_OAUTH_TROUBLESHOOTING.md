# Google OAuth Troubleshooting Guide — RateMyPlace Boston

## Context for Claude

I need help debugging Google OAuth on my production website. This is a **non-code task** — I need guidance navigating the Google Cloud Console, checking configuration, and resolving errors. Please walk me through this step by step, asking me what I see at each stage.

## Project Details

- **Live site**: https://ratemyplace.org
- **Hosting**: Cloudflare Pages (SSR via Astro 5.x)
- **Auth system**: Lucia v3 with Google OAuth 2.0 (manual implementation, no SDK)
- **Environment variables** are stored in Cloudflare Pages dashboard (not in code)

## How the OAuth Flow Works

1. User clicks "Sign in with Google" on the site
2. App redirects to Google with these parameters:
   - `client_id` from env var `GOOGLE_CLIENT_ID`
   - `redirect_uri` = `https://ratemyplace.org/api/auth/google/callback`
   - `scope` = `openid email profile`
   - `response_type` = `code`
   - `prompt` = `select_account`
3. User authenticates with Google
4. Google redirects back to `https://ratemyplace.org/api/auth/google/callback` with an authorization code
5. Server exchanges the code for tokens at `https://oauth2.googleapis.com/token`
6. Server fetches user info from `https://www.googleapis.com/oauth2/v3/userinfo`
7. Server creates or links the user account and sets a session cookie

## Known Error Redirects

The app redirects to `/auth/signin?error=<code>` on failure. These are the possible error codes and what they mean:

| Error Code | Meaning |
|------------|---------|
| `oauth_not_configured` | `GOOGLE_CLIENT_ID` env var is missing on the server |
| `oauth_denied` | Google returned an error (user denied, or Google blocked the request) |
| `invalid_state` | CSRF state cookie didn't match — could be expired cookie (>10 min), or cross-site issue |
| `no_code` | Google redirected back but didn't include an authorization code |
| `token_exchange_failed` | Server failed to exchange the auth code for tokens (bad client secret, wrong redirect URI, expired code) |
| `userinfo_failed` | Got tokens but couldn't fetch user profile from Google |
| `no_email` | Google returned a profile with no email address |
| `oauth_failed` | Catch-all for unexpected server errors during the callback |

## What I Need Help With

Please help me work through these checks:

### 1. Google Cloud Console Configuration
- Is the OAuth consent screen properly configured?
- Is the app in "Testing" or "Production" mode? (Testing mode limits to manually added test users)
- Are the correct scopes enabled? (needs `openid`, `email`, `profile`)

### 2. OAuth Client ID Settings
- Is the client type "Web application"?
- Are the **Authorized JavaScript origins** correct? Should include:
  - `https://ratemyplace.org`
- Are the **Authorized redirect URIs** correct? Must include exactly:
  - `https://ratemyplace.org/api/auth/google/callback`

### 3. Cloudflare Environment Variables
- Is `GOOGLE_CLIENT_ID` set in Cloudflare Pages settings?
- Is `GOOGLE_CLIENT_SECRET` set in Cloudflare Pages settings?
- Are they set for the **Production** environment (not just Preview)?
- Were the values redeployed after being added? (Cloudflare requires a new deployment to pick up env var changes)

### 4. Common Pitfalls
- Trailing slashes in redirect URIs (Google requires exact match)
- Client secret may have been rotated or regenerated in Google Console
- App may still be in "Testing" publishing status, blocking non-test-user logins
- OAuth consent screen may be missing required fields (app name, support email, developer email)
- If the Google Cloud project has billing issues, APIs can be silently disabled

## How to Reproduce

1. Go to https://ratemyplace.org
2. Click sign in / sign up
3. Choose "Sign in with Google"
4. Observe what happens — does Google's page load? Does it error? Does it redirect back with an error code?

## What I'll Need to Check

- **Google Cloud Console**: https://console.cloud.google.com/ → APIs & Services → Credentials
- **OAuth Consent Screen**: https://console.cloud.google.com/ → APIs & Services → OAuth consent screen
- **Cloudflare Dashboard**: https://dash.cloudflare.com/ → Pages → ratemyplace project → Settings → Environment variables

Please guide me through each of these step by step, asking me what I see on screen so we can identify the issue together.
