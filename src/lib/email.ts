import { Resend } from 'resend';

interface EmailResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

/**
 * Send verification email to user
 *
 * @param apiKey - Resend API key from environment
 * @param siteUrl - Base URL for verification link
 * @param toEmail - User's email address
 * @param token - Verification token
 */
export async function sendVerificationEmail(
  apiKey: string,
  siteUrl: string,
  toEmail: string,
  token: string
): Promise<EmailResult> {
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const resend = new Resend(apiKey);
  const verificationUrl = `${siteUrl}/api/auth/verify-email?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: 'RateMyPlace Boston <noreply@ratemyplace.com>',
      to: toEmail,
      subject: 'Verify your email address',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0d9488;">Welcome to RateMyPlace Boston!</h2>

  <p>Please verify your email address to get the verified badge on your reviews.</p>

  <p style="margin: 30px 0;">
    <a href="${verificationUrl}"
       style="background-color: #0d9488; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Verify Email Address
    </a>
  </p>

  <p style="color: #666; font-size: 14px;">
    Or copy and paste this link into your browser:<br>
    <a href="${verificationUrl}" style="color: #0d9488; word-break: break-all;">${verificationUrl}</a>
  </p>

  <p style="color: #666; font-size: 14px;">This link will expire in 24 hours.</p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="color: #999; font-size: 12px;">
    If you didn't create an account on RateMyPlace Boston, you can safely ignore this email.
  </p>
</body>
</html>
      `,
    });

    if (error) {
      console.error('Resend error:', error);
      return { success: false, error: error.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    console.error('Email send exception:', err);
    return { success: false, error: 'Failed to send email' };
  }
}
