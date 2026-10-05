import { sanitizeMultilineText } from '../validation';

export const ADMIN_NOTES_MAX = 1000;

/**
 * Validates an `admin_notes` value from an admin request body. `undefined` means "not sent"
 * (leave the column alone); blank means clear it (null). Over 1000 characters after
 * sanitizing, or a non-string, is an error.
 */
export function parseAdminNotes(
  value: unknown,
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'Admin notes must be text' };
  const clean = sanitizeMultilineText(value);
  if (clean.length > ADMIN_NOTES_MAX) {
    return { ok: false, error: `Admin notes must be ${ADMIN_NOTES_MAX} characters or less` };
  }
  return { ok: true, value: clean || null };
}

/**
 * A `json_group_array(DISTINCT …)` column as a clean string list: nulls and blanks dropped,
 * values trimmed. Unparseable input yields [] rather than failing the whole list.
 */
export function stringListFromJson(json: unknown): string[] {
  if (typeof json !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const values = parsed.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
    return Array.from(new Set(values));
  } catch {
    return [];
  }
}
