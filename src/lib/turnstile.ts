const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileResult {
  success: boolean;
  error?: string;
}

export async function verifyTurnstile(token: string, secretKey: string, ip?: string): Promise<TurnstileResult> {
  if (!token) {
    return { success: false, error: 'Turnstile verification required' };
  }

  if (!secretKey) {
    // Fail CLOSED in production: a missing secret in prod is a misconfiguration
    // that would silently disable bot protection on every form. Only skip in dev.
    if (import.meta.env.PROD) {
      console.error('TURNSTILE_SECRET_KEY not set in production — failing closed');
      return { success: false, error: 'Bot verification is unavailable. Please try again later.' };
    }
    console.warn('TURNSTILE_SECRET_KEY not set — skipping verification (dev only)');
    return { success: true };
  }

  try {
    const body: Record<string, string> = {
      secret: secretKey,
      response: token,
    };
    if (ip) {
      body.remoteip = ip;
    }

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await response.json() as { success: boolean; 'error-codes'?: string[] };

    if (!result.success) {
      const codes = result['error-codes']?.join(', ') || 'unknown';
      console.error('Turnstile verification failed:', codes);
      return { success: false, error: 'Bot verification failed. Please try again.' };
    }

    return { success: true };
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return { success: false, error: 'Verification service unavailable. Please try again.' };
  }
}
