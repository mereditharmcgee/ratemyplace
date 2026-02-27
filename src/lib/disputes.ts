// Landlord disputes utility functions

// Valid dispute reasons
export const DISPUTE_REASONS = [
  'Factually incorrect information',
  'Defamatory or false statements',
  'Review is for wrong property',
  'Tenant never lived here',
  'Contains inappropriate content',
  'Other',
] as const;

export type DisputeReason = (typeof DISPUTE_REASONS)[number];

export interface DisputeFormData {
  landlordName: string;
  landlordEmail: string;
  landlordPhone: string;
  disputeReasons: string[];
  disputeExplanation?: string;
  reviewUrl: string;
}

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Extract review ID from a review URL
 *
 * Handles two URL patterns:
 * - Hash pattern: https://site.com/building/123#review-abc123
 * - Edit pattern: https://site.com/review/edit/abc123
 *
 * @param urlString - The URL to parse
 * @param siteUrl - The expected site origin (e.g., "https://ratemyplace.org")
 * @returns The review ID or null if invalid
 */
export function extractReviewIdFromUrl(
  urlString: string,
  siteUrl: string
): string | null {
  try {
    const url = new URL(urlString);
    const expectedOrigin = new URL(siteUrl).origin;

    // Verify origin matches
    if (url.origin !== expectedOrigin) {
      return null;
    }

    // Check for hash pattern: #review-{id}
    if (url.hash.startsWith('#review-')) {
      const reviewId = url.hash.substring(8); // Remove '#review-'
      return reviewId || null;
    }

    // Check for edit pattern: /review/edit/{id}
    const pathMatch = url.pathname.match(/^\/review\/edit\/([^\/]+)$/);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1];
    }

    return null;
  } catch (error) {
    // Malformed URL
    return null;
  }
}

/**
 * Validate dispute form data
 *
 * @param data - The form data to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateDisputeForm(data: DisputeFormData): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate landlordName
  if (!data.landlordName || data.landlordName.trim() === '') {
    errors.push({ field: 'landlordName', message: 'Landlord name is required' });
  }

  // Validate landlordEmail
  if (!data.landlordEmail || data.landlordEmail.trim() === '') {
    errors.push({ field: 'landlordEmail', message: 'Landlord email is required' });
  } else {
    // Simple email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.landlordEmail)) {
      errors.push({ field: 'landlordEmail', message: 'Invalid email format' });
    }
  }

  // Validate landlordPhone
  if (!data.landlordPhone || data.landlordPhone.trim() === '') {
    errors.push({ field: 'landlordPhone', message: 'Landlord phone is required' });
  }

  // Validate disputeReasons
  if (!data.disputeReasons || data.disputeReasons.length === 0) {
    errors.push({ field: 'disputeReasons', message: 'At least one dispute reason is required' });
  }

  return errors;
}
