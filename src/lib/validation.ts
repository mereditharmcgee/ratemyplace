import type { ReviewFormData, Season, UnitType } from './types';

const validSeasons: Season[] = ['winter', 'spring', 'summer', 'fall'];
const validUnitTypes: UnitType[] = ['studio', '1br', '2br', '3br', '4br+', 'house'];

export interface ValidationError {
  field: string;
  message: string;
}

export function validateReviewForm(data: Partial<ReviewFormData & { move_in_month?: number }>): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required fields
  if (!data.building_id) {
    errors.push({ field: 'building_id', message: 'Building is required' });
  }

  if (!data.move_in_year || data.move_in_year < 1900 || data.move_in_year > new Date().getFullYear()) {
    errors.push({ field: 'move_in_year', message: 'Valid move-in year is required' });
  }

  // Accept either move_in_month (new: integer 1-12) or move_in_season (legacy: season string)
  if (data.move_in_month !== undefined) {
    // New path: validate month integer
    if (!Number.isInteger(data.move_in_month) || data.move_in_month < 1 || data.move_in_month > 12) {
      errors.push({ field: 'move_in_month', message: 'Valid move-in month is required (1-12)' });
    }
  } else if (data.move_in_season !== undefined) {
    // Legacy path: validate season string (backward compat)
    if (!validSeasons.includes(data.move_in_season)) {
      errors.push({ field: 'move_in_season', message: 'Valid move-in season is required' });
    }
  }

  if (!data.unit_type || !validUnitTypes.includes(data.unit_type)) {
    errors.push({ field: 'unit_type', message: 'Valid unit type is required' });
  }

  // Move-out validation (required if not current tenant)
  if (!data.is_current_tenant) {
    if (data.move_out_year) {
      if (data.move_out_year < 1900 || data.move_out_year > new Date().getFullYear()) {
        errors.push({ field: 'move_out_year', message: 'Valid move-out year is required' });
      }

      if (data.move_in_year && data.move_out_year < data.move_in_year) {
        errors.push({ field: 'move_out_year', message: 'Move-out date must be after move-in date' });
      }
    }

    if (data.move_out_season && !validSeasons.includes(data.move_out_season)) {
      errors.push({ field: 'move_out_season', message: 'Valid move-out season is required' });
    }
  }

  // Rent validation
  if (data.rent_amount !== undefined && data.rent_amount !== null) {
    if (data.rent_amount < 0 || data.rent_amount > 50000) {
      errors.push({ field: 'rent_amount', message: 'Rent amount must be between $0 and $50,000' });
    }
  }

  // Score validation
  if (data.scores) {
    const scoreFields = [
      'building_quality',
      'maintenance',
      'pest_control',
      'safety',
      'noise',
      'landlord_responsiveness',
      'landlord_communication',
      'landlord_fairness',
      'lease_clarity',
      'deposit_handling',
      'rent_value',
      'amenities',
    ] as const;

    for (const field of scoreFields) {
      const score = data.scores[field];
      if (score !== undefined && score !== null) {
        if (score < 1 || score > 5 || !Number.isInteger(score)) {
          errors.push({ field: `scores.${field}`, message: `${field} must be between 1 and 5` });
        }
      }
    }
  }

  // Review text validation
  if (data.review_title && data.review_title.length > 200) {
    errors.push({ field: 'review_title', message: 'Title must be 200 characters or less' });
  }

  if (data.review_text && data.review_text.length > 5000) {
    errors.push({ field: 'review_text', message: 'Review must be 5000 characters or less' });
  }

  return errors;
}

// ═══════════════════════════════════════════════════
// Shared validation primitives (VAL-05)
// ═══════════════════════════════════════════════════

/**
 * Pragmatic email format check. Accepts anything with non-whitespace before
 * '@', non-whitespace before '.', non-whitespace after. Catches "notanemail"
 * and typical typos. NOT RFC 5322 strict — accepts a@b.c.
 *
 * Locked in CONTEXT.md: must reject 'notanemail', accept 'a@b.c'.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * US zip code: 5-digit or 5+4 (ZIP+4) format.
 * Future-proof for out-of-state landlords on disputes.
 */
export function isValidZipCode(zip: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(zip);
}

/**
 * True only for absolute http(s) URLs. Used to reject `javascript:`, `data:`,
 * and other dangerous schemes before a user-supplied URL is stored and later
 * rendered as a clickable link in the admin panel (React renders a
 * `javascript:` href, so an admin click would run attacker script same-origin).
 * Both the write path and the render path gate on this.
 */
export function isSafeHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const scheme = new URL(value).protocol;
    return scheme === 'http:' || scheme === 'https:';
  } catch {
    return false;
  }
}

/**
 * Canonical max-length helper. Returns null when value is undefined/null/empty
 * or within bounds; returns ValidationError when over max.
 *
 * Validators stay pure — this helper is the only allocation path for
 * length errors so error shapes stay consistent across forms.
 */
export function enforceMaxLength(
  value: string | undefined | null,
  max: number,
  fieldName: string,
  label: string
): ValidationError | null {
  if (value && value.length > max) {
    return { field: fieldName, message: `${label} must be ${max} characters or less.` };
  }
  return null;
}

/**
 * Escape SQLite LIKE wildcards so user input matches literally.
 * Order matters: escape backslash FIRST (it's the chosen escape char itself),
 * then percent and underscore. Without escaping the backslash, an input like
 * '\%' would consume the next character and break the escape sequence.
 *
 * Use with `LIKE ? ESCAPE '\'` in the SQL clause (one ESCAPE per LIKE).
 */
export function escapeLikePattern(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

// ═══════════════════════════════════════════════════
// Form validators (VAL-01, VAL-02, VAL-03, VAL-04)
// ═══════════════════════════════════════════════════

/**
 * VAL-01: Validate dispute submission body.
 * Required: landlordName, landlordEmail, landlordPhone.
 * Optional: disputeExplanation.
 *
 * Business-logic checks (disputeReasons array, reviewUrl extraction,
 * review existence) stay inline in the endpoint — this validator only
 * checks form field values that map to user inputs.
 */
export function validateDisputeForm(body: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  const { landlordName, landlordEmail, landlordPhone, disputeExplanation } = body;

  // landlordName: required, max 200
  if (!landlordName || typeof landlordName !== 'string' || !landlordName.trim()) {
    errors.push({ field: 'landlordName', message: 'Landlord name is required.' });
  } else {
    const err = enforceMaxLength(landlordName, 200, 'landlordName', 'Landlord name');
    if (err) errors.push(err);
  }

  // landlordEmail: required, format check
  if (!landlordEmail || typeof landlordEmail !== 'string' || !landlordEmail.trim()) {
    errors.push({ field: 'landlordEmail', message: 'Landlord email is required.' });
  } else if (!isValidEmail(landlordEmail.trim())) {
    errors.push({ field: 'landlordEmail', message: 'Email format is invalid.' });
  }

  // landlordPhone: required, max 30
  if (!landlordPhone || typeof landlordPhone !== 'string' || !landlordPhone.trim()) {
    errors.push({ field: 'landlordPhone', message: 'Landlord phone is required.' });
  } else {
    const err = enforceMaxLength(landlordPhone, 30, 'landlordPhone', 'Landlord phone');
    if (err) errors.push(err);
  }

  // disputeExplanation: optional, max 5000
  if (disputeExplanation && typeof disputeExplanation === 'string') {
    const err = enforceMaxLength(disputeExplanation, 5000, 'disputeExplanation', 'Dispute explanation');
    if (err) errors.push(err);
  }

  return errors;
}

/**
 * VAL-02: Validate bug report payload.
 * Required: description (10-5000 chars).
 * Optional: email (format-checked if present), category, url (max 2000 chars).
 */
export function validateBugReport(data: {
  email?: string;
  category?: string;
  description?: string;
  url?: string;
}): ValidationError[] {
  const errors: ValidationError[] = [];
  const description = (data.description || '').trim();

  if (!description || description.length < 10) {
    errors.push({ field: 'description', message: 'Description must be at least 10 characters.' });
  } else {
    const err = enforceMaxLength(description, 5000, 'description', 'Description');
    if (err) errors.push(err);
  }

  if (data.email && data.email.trim()) {
    if (!isValidEmail(data.email.trim())) {
      errors.push({ field: 'email', message: 'Email format is invalid.' });
    }
  }

  if (data.url) {
    const err = enforceMaxLength(data.url, 2000, 'url', 'URL');
    if (err) errors.push(err);
    else if (!isSafeHttpUrl(data.url.trim())) {
      errors.push({ field: 'url', message: 'URL must start with http:// or https://.' });
    }
  }

  return errors;
}

/**
 * VAL-03: Validate contact form payload.
 * Required: name (2-100), email (format check), message (10-3000).
 * Optional: category (whitelist enforcement happens at endpoint).
 */
export function validateContactForm(data: {
  name?: string;
  email?: string;
  category?: string;
  message?: string;
}): ValidationError[] {
  const errors: ValidationError[] = [];
  const name = (data.name || '').trim();
  const email = (data.email || '').trim();
  const message = (data.message || '').trim();

  if (!name || name.length < 2) {
    errors.push({ field: 'name', message: 'Name must be at least 2 characters.' });
  } else {
    const err = enforceMaxLength(name, 100, 'name', 'Name');
    if (err) errors.push(err);
  }

  if (!email) {
    errors.push({ field: 'email', message: 'Email is required.' });
  } else if (!isValidEmail(email)) {
    errors.push({ field: 'email', message: 'Email format is invalid.' });
  }

  if (!message || message.length < 10) {
    errors.push({ field: 'message', message: 'Message must be at least 10 characters.' });
  } else {
    const err = enforceMaxLength(message, 3000, 'message', 'Message');
    if (err) errors.push(err);
  }

  return errors;
}

/**
 * VAL-04: Validate search query.
 * Length cap (200 chars) applies to TRIMMED query.
 * Empty query is allowed (browse-all use case on /api/search/results).
 * No minimum length enforcement (autocomplete handles short queries silently).
 */
export function validateSearch(q: string | null): ValidationError[] {
  const errors: ValidationError[] = [];
  const trimmed = (q || '').trim();
  if (trimmed.length > 200) {
    errors.push({ field: 'q', message: 'Search query must be 200 characters or less.' });
  }
  return errors;
}

export function sanitizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/<[^>]*>/g, '');
}
