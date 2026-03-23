/**
 * Convert a snake_case value to a human-readable label.
 * Used as a fallback when a display label map doesn't contain a value.
 * e.g. "small_dogs" → "Small Dogs", "in_unit" → "In Unit"
 */
export function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
