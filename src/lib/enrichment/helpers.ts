export function inferOwnerEntity(ownerName: string): string | null {
  const upper = ownerName.toUpperCase();
  if (upper.includes('LLC')) return 'llc';
  if (upper.includes('TRUST') || upper.includes('TRUSTEE') || upper.includes('TRSTEE')) return 'trust';
  if (upper.includes('CORP') || upper.includes('INC') || upper.includes('INCORPORATED')) return 'corporation';
  if (upper.includes('PARTNERSHIP') || upper.includes(' LP') || upper.includes('L.P.')) return 'partnership';
  if (upper.includes('REIT')) return 'reit';
  if (upper.includes('AUTHORITY') || upper.includes('CITY OF') || upper.includes('COMMONWEALTH')) return 'other';
  return 'individual';
}

export function parseStreetAddress(address: string): { number: string; street: string } | null {
  // Handle addresses like "123 Main St", "123-125 Main St", "123A Main St"
  const match = address.match(/^(\d+[\-\d]*[A-Z]?)\s+(.+)/i);
  if (!match) return null;
  return { number: match[1], street: match[2] };
}

export function normalizeStreetName(street: string): string {
  // Remove city/state/zip suffix, normalize for matching
  return street
    .replace(/,.*$/, '')          // Remove everything after comma
    .replace(/\b(apt|unit|#)\s*\S+/i, '')  // Remove apt/unit numbers
    .trim()
    .toUpperCase();
}
