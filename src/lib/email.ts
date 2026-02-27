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
      subject: 'Dispute Submitted - RateMyPlace Boston',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0d9488;">Thank you for submitting your dispute</h2>

  <p>Dear ${disputeDetails.landlordName},</p>

  <p>We have received your dispute for the review at <strong>${disputeDetails.buildingAddress}</strong>.</p>

  <div style="background-color: #f9fafb; border-left: 4px solid #0d9488; padding: 16px; margin: 20px 0;">
    <p style="margin: 0 0 10px 0;"><strong>Dispute Reasons:</strong></p>
    <ul style="margin: 0; padding-left: 20px;">
      ${reasonsList}
    </ul>
    ${disputeDetails.disputeExplanation ? `
    <p style="margin: 16px 0 0 0;"><strong>Additional Explanation:</strong></p>
    <p style="margin: 8px 0 0 0; color: #666;">${disputeDetails.disputeExplanation}</p>
    ` : ''}
  </div>

  <p>Our admin team will carefully review your dispute. If the dispute is upheld, you will receive a notification email with the resolution details.</p>

  <p style="color: #666; font-size: 14px;">Thank you for helping us maintain accurate information on RateMyPlace Boston.</p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="color: #999; font-size: 12px;">
    This is a confirmation of your dispute submission. For questions, please contact us through the website.
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
 * Send dispute upheld notification to landlord
 *
 * @param apiKey - Resend API key from environment
 * @param toEmail - Landlord's email address
 * @param landlordName - Landlord's name
 * @param resolutionNotes - Admin's resolution notes
 */
export async function sendDisputeUpheldEmail(
  apiKey: string,
  toEmail: string,
  landlordName: string,
  resolutionNotes: string
): Promise<EmailResult> {
  if (!apiKey) {
    console.error('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: 'RateMyPlace Boston <noreply@ratemyplace.org>',
      to: toEmail,
      subject: 'Dispute Resolution - RateMyPlace Boston',
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0d9488;">Your dispute has been reviewed</h2>

  <p>Dear ${landlordName},</p>

  <p>After careful review, we have <strong>upheld your dispute</strong>. The review in question has been addressed according to our policies.</p>

  <div style="background-color: #f9fafb; border-left: 4px solid #0d9488; padding: 16px; margin: 20px 0;">
    <p style="margin: 0 0 10px 0;"><strong>Resolution Notes:</strong></p>
    <p style="margin: 0; color: #666;">${resolutionNotes}</p>
  </div>

  <p>The appropriate action has been taken based on our review of your dispute.</p>

  <p style="color: #666; font-size: 14px;">Thank you for bringing this to our attention and helping us maintain the integrity of RateMyPlace Boston.</p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="color: #999; font-size: 12px;">
    This is a resolution notification for your dispute. For questions, please contact us through the website.
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
