// The seed's land-use unit estimate, in one place for its two readers: the seed writes it into
// `buildings.unit_count` (`collapse.ts`), and the building page labels a stored count that
// matches it as an estimate (`buildingDetails.ts`). A leaf: no imports, so the page can read
// the table without pulling the seed pipeline in with it.

/**
 * Units a land-use code implies for one building when the assessor leaves RES_UNITS blank.
 * LU describes the *parcel*, so on a multi-building lot applying it per building is a
 * stated guess, not a fact: a second, blank R3 row is credited three units on the theory
 * that a three-family lot's second structure is also a three-family. Rows the assessor did
 * count are always preferred; nothing is implied for A, R4, or RC.
 */
export const IMPLIED_UNITS: Readonly<Record<string, number>> = { R2: 2, R3: 3 };

/**
 * The units a land-use code implies, or null when the seed implies none for it. Normalized the
 * way `normalizeLandUse` in `filters.ts` normalizes, so a stored payload's raw `LU` reads the
 * same as the code the seed keyed on.
 */
export function impliedUnitsFor(landUse: string | null | undefined): number | null {
  const code = (landUse ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(IMPLIED_UNITS, code) ? IMPLIED_UNITS[code] : null;
}
