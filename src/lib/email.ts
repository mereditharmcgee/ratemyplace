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
      from: 'RateMyPlace Boston <noreply@ratemyplace.org>',
      to: toEmail,
      subject: 'Verify your email',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0d9488;">Verify your email</h2>

  <p>Confirm your email so you can post reviews. The next tenant is reading.</p>

  <p style="margin: 30px 0;">
    <a href="${verificationUrl}"
       style="background-color: #0d9488; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Verify email
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

/**
 * Send password reset email to user
 *
 * @param apiKey - Resend API key from environment
 * @param siteUrl - Base URL for reset link
 * @param toEmail - User's email address
 * @param token - Password reset token
 */
export async function sendPasswordResetEmail(
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
  const resetUrl = `${siteUrl}/auth/reset-password?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: 'RateMyPlace Boston <noreply@ratemyplace.org>',
      to: toEmail,
      subject: 'Reset your password',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0d9488;">Reset Your Password</h2>

  <p>We received a request to reset your password for your RateMyPlace Boston account.</p>

  <p style="margin: 30px 0;">
    <a href="${resetUrl}"
       style="background-color: #0d9488; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      Reset Password
    </a>
  </p>

  <p style="color: #666; font-size: 14px;">
    Or copy and paste this link into your browser:<br>
    <a href="${resetUrl}" style="color: #0d9488; word-break: break-all;">${resetUrl}</a>
  </p>

  <p style="color: #dc2626; font-size: 14px; font-weight: 500;">This link will expire in 1 hour.</p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="color: #999; font-size: 12px;">
    If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.
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

/**
 * Send dispute confirmation email to landlord
 *
 * @param apiKey - Resend API key from environment
 * @param siteUrl - Base URL for site reference
 * @param toEmail - Landlord's email address
 * @param disputeDetails - Details about the dispute
 */
export async function sendDisputeConfirmationEmail(
  apiKey: string,
  siteUrl: string,
  toEmail: string,
  disputeDetails: {
    landlordName: string;
    buildingAddress: string;
    disputeReasons: string[];
    disputeExplanation?: string;
  }
): Promise<EmailResult> {
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const resend = new Resend(apiKey);

  const reasonsList = disputeDetails.disputeReasons
    .map(reason => `<li>${reason}</li>`)
    .join('');

  try {
    const { data, error } = await resend.emails.send({
      from: 'RateMyPlace Boston <noreply@ratemyplace.org>',
      to: toEmail,
      subject: 'We received your dispute',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0d9488;">We received your dispute</h2>

  <p>Hi ${disputeDetails.landlordName},</p>

  <p>Your dispute about the review at <strong>${disputeDetails.buildingAddress}</strong> is in our queue.</p>

  <div style="background-color: #f9fafb; border-left: 4px solid #0d9488; padding: 16px; margin: 20px 0;">
    <p style="margin: 0 0 10px 0;"><strong>Reasons cited:</strong></p>
    <ul style="margin: 0; padding-left: 20px;">
      ${reasonsList}
    </ul>
    ${disputeDetails.disputeExplanation ? `
    <p style="margin: 16px 0 0 0;"><strong>Your explanation:</strong></p>
    <p style="margin: 8px 0 0 0; color: #666;">${disputeDetails.disputeExplanation}</p>
    ` : ''}
  </div>

  <p>We'll review and follow up by email with the outcome, whether we uphold, partially uphold, or dismiss the dispute.</p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="color: #999; font-size: 12px;">
    Sent automatically. Reach us via <a href="https://ratemyplace.org/contact" style="color: #0d9488;">ratemyplace.org/contact</a> for follow-ups.
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

/**
 * Send contact form confirmation email to submitter
 *
 * @param apiKey - Resend API key from environment
 * @param toEmail - Submitter's email address
 * @param toName - Submitter's name
 * @param category - Contact category (general, privacy, support, landlord)
 */
export async function sendContactConfirmationEmail(
  apiKey: string,
  toEmail: string,
  toName: string,
  category: string
): Promise<EmailResult> {
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const resend = new Resend(apiKey);

  const categoryLabels: Record<string, string> = {
    general: 'general inquiry',
    privacy: 'privacy concern',
    support: 'support request',
    landlord: 'landlord/property manager inquiry',
  };
  const categoryLabel = categoryLabels[category] || 'inquiry';

  try {
    const { data, error } = await resend.emails.send({
      // Sent from support@ so replies land in a real inbox (Cloudflare Email Routing
      // catch-all forwards all @ratemyplace.org addresses). This makes the "reply or
      // use the form" footer below honest.
      from: 'RateMyPlace Boston <support@ratemyplace.org>',
      to: toEmail,
      replyTo: 'support@ratemyplace.org',
      subject: 'We received your message',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0d9488;">We received your message</h2>

  <p>Hi ${toName},</p>

  <p>We've got your ${categoryLabel} and will reply within 2-3 business days.</p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="color: #999; font-size: 12px;">
    Sent automatically. Reply to this email or use <a href="https://ratemyplace.org/contact" style="color: #0d9488;">ratemyplace.org/contact</a>. Both reach us.
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

/**
 * Send contact form notification email to admin
 *
 * @param apiKey - Resend API key from environment
 * @param submitterName - Name of the person who submitted
 * @param submitterEmail - Email of the person who submitted
 * @param category - Contact category
 * @param messagePreview - First 200 chars of the message
 */
export async function sendContactNotificationEmail(
  apiKey: string,
  submitterName: string,
  submitterEmail: string,
  category: string,
  messagePreview: string
): Promise<EmailResult> {
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: 'RateMyPlace Boston <noreply@ratemyplace.org>',
      to: 'contact@ratemyplace.org',
      subject: `New contact: ${category} from ${submitterName}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0d9488;">New Contact Form Submission</h2>

  <div style="background-color: #f9fafb; border-left: 4px solid #0d9488; padding: 16px; margin: 20px 0;">
    <p style="margin: 0 0 8px 0;"><strong>Name:</strong> ${submitterName}</p>
    <p style="margin: 0 0 8px 0;"><strong>Email:</strong> <a href="mailto:${submitterEmail}" style="color: #0d9488;">${submitterEmail}</a></p>
    <p style="margin: 0 0 8px 0;"><strong>Category:</strong> ${category}</p>
    <p style="margin: 16px 0 4px 0;"><strong>Message preview:</strong></p>
    <p style="margin: 0; color: #666;">${messagePreview}</p>
  </div>

  <p style="color: #666; font-size: 14px;">
    View all submissions at <a href="https://ratemyplace.org/admin/contact" style="color: #0d9488;">ratemyplace.org/admin/contact</a>
  </p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="color: #999; font-size: 12px;">This is an automated admin notification from RateMyPlace Boston.</p>
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

/**
 * Send dispute resolution email to landlord. Handles all three resolution
 * outcomes (upheld, dismissed, partially upheld) so a landlord always hears
 * back, regardless of which way the dispute lands.
 *
 * @param apiKey - Resend API key from environment
 * @param toEmail - Landlord's email address
 * @param landlordName - Landlord's name
 * @param outcome - Resolution outcome ('uphold' | 'dismiss' | 'partially_valid')
 * @param resolutionNotes - Admin's resolution notes (shown verbatim)
 */
export type DisputeResolutionOutcome = 'uphold' | 'dismiss' | 'partially_valid';

interface DisputeOutcomeCopy {
  subject: string;
  heading: string;
  lede: string;
}

const DISPUTE_OUTCOME_COPY: Record<DisputeResolutionOutcome, DisputeOutcomeCopy> = {
  uphold: {
    subject: 'We upheld your dispute',
    heading: 'We upheld your dispute',
    lede: 'We\'ve upheld your dispute. The review has been updated according to our <a href="https://ratemyplace.org/guidelines" style="color: #0d9488;">content guidelines</a>.',
  },
  dismiss: {
    subject: 'We did not uphold your dispute',
    heading: 'We did not uphold your dispute',
    lede: 'We reviewed your dispute and decided not to act on it. The review stands. Reviews can be valid even when a landlord disagrees, so long as they meet our <a href="https://ratemyplace.org/guidelines" style="color: #0d9488;">content guidelines</a>.',
  },
  partially_valid: {
    subject: 'We partially upheld your dispute',
    heading: 'We partially upheld your dispute',
    lede: 'We found some of your concerns valid and addressed them. Other parts of the review stand. Specifics are in the resolution notes below.',
  },
};

export async function sendDisputeResolutionEmail(
  apiKey: string,
  toEmail: string,
  landlordName: string,
  outcome: DisputeResolutionOutcome,
  resolutionNotes: string
): Promise<EmailResult> {
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const resend = new Resend(apiKey);
  const copy = DISPUTE_OUTCOME_COPY[outcome];

  try {
    const { data, error } = await resend.emails.send({
      from: 'RateMyPlace Boston <noreply@ratemyplace.org>',
      to: toEmail,
      subject: copy.subject,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0d9488;">${copy.heading}</h2>

  <p>Hi ${landlordName},</p>

  <p>${copy.lede}</p>

  <div style="background-color: #f9fafb; border-left: 4px solid #0d9488; padding: 16px; margin: 20px 0;">
    <p style="margin: 0 0 10px 0;"><strong>Resolution notes:</strong></p>
    <p style="margin: 0; color: #666;">${resolutionNotes}</p>
  </div>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="color: #999; font-size: 12px;">
    Sent automatically. Reach us via <a href="https://ratemyplace.org/contact" style="color: #0d9488;">ratemyplace.org/contact</a>.
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
