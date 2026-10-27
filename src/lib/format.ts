/**
 * Convert a snake_case value to a human-readable label.
 * Used as a fallback when a display label map doesn't contain a value.
 * e.g. "small_dogs" → "Small Dogs", "in_unit" → "In Unit"
 */
export function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const EASTERN_DATE_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * A Unix-seconds timestamp as Boston wall-clock time, e.g. "Jul 17, 2026, 9:30 PM ET".
 *
 * For admin surfaces and owner notices only — never a public page, where exact times go
 * through `privacy.ts`. Newer ICU puts a narrow no-break space (U+202F) before AM/PM and
 * some builds use U+00A0; both become plain spaces, so the output is always printable ASCII
 * and safe in an email subject line.
 */
export function formatEasternDateTime(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return 'Time not recorded';
  return EASTERN_DATE_TIME.format(new Date(unixSeconds * 1000)).replace(/[\u202F\u00A0]/g, ' ') + ' ET';
}
