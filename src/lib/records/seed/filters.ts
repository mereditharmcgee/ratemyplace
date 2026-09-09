import { textOrNull } from '../ckan';
import type { AssessorRow } from './types';

/** Land-use codes the seed downloads. R1 (single-family), CD/CM (condos), RL (land) are out of scope. */
export const SEED_LAND_USES = ['A', 'R2', 'R3', 'R4', 'RC'] as const;

/**
 * 'A' is the assessor's catch-all for apartment-class parcels. Only these descriptions are
 * housing. Excluded on purpose (verified against the FY2026 list on 2026-09-08):
 * DORMITORY bd, DORM /Residence Hall, DAY CARE CENTER, RES PARKING LOT, RES PARKING GARAGE,
 * RECTORY, CONVENT, LODGING SUITES, ELDERLY HOME (nursing homes).
 */
export const HOUSING_A_DESCRIPTIONS = [
  'APT 7-30 UNITS',
  'APT 31-99 UNITS',
  'APT 100+ UNITS',
  'LUXURY APARTMENT',
  'SUBSD HOUSING S- 8',
  'SUBSD HOUSING S-202',
  'SUBSD HOUSING S-231D',
  'ROOMING HOUSE',
] as const;

const HOUSING_A = new Set<string>(HOUSING_A_DESCRIPTIONS);
const ALWAYS = new Set<string>(['R2', 'R3', 'R4', 'RC']);

function norm(value: unknown): string {
  return (textOrNull(value) ?? '').trim().toUpperCase();
}

/** Whether one assessor row belongs in the seed. Pure; the row shape is whatever CKAN returned. */
export function isSeedParcelRow(row: Pick<AssessorRow, 'LU' | 'LU_DESC'>): boolean {
  const lu = norm(row.LU);
  if (ALWAYS.has(lu)) return true;
  if (lu === 'A') return HOUSING_A.has(norm(row.LU_DESC));
  return false;
}
