// Rules for linking an assessor owner of record to the other buildings recorded under the
// same name. Pure functions only: nothing here reads the database. The lookup itself is not
// built yet, because the owner name lives only inside `building_records.payload` JSON and a
// name match across every building is a full scan of that table on each request (see
// docs/superpowers/specs/2026-10-27-owner-of-record-list-design.md). These rules hold
// whatever storage the lookup ends up using.
//
// Three rules, each a guardrail rather than a formatting choice:
// 1. Group by the exact owner name only, normalized for case, spacing and punctuation.
//    Never by tax mailing address: a shared mailing address suggests who manages a
//    property, it is not a record of who owns it.
// 2. An owner that reads as an entity (LLC, LP, TRUST, REALTY, ...) can be linked. A person
//    can be linked only when two or more residential parcels in our data carry the same
//    name, so no list is built for someone who owns one home.
// 3. A condominium parcel shows no single owner, so it never yields a link or a list row.
import { showMailingAddress } from './display';
import { isSeedParcelRow, normalizeLandUse } from './seed/filters';
import type { AssessmentPayload } from './types';

/** A person's name is linkable only at or above this many residential parcels in our data. */
export const MIN_PARCELS_FOR_PERSON = 2;

/**
 * Tokens that mark an owner name as an entity for linking, on top of the mailing-address
 * gate's own list in `display.ts`. Kept separate on purpose: adding a token there would
 * publish more tax mailing addresses, which is a privacy decision, not a linking one.
 * Word-boundary matched against the normalized name, so MANAGEMENT does not match inside a
 * longer word and LTD does not match inside a surname.
 */
const LINK_ONLY_ENTITY_TOKEN = /\b(MANAGEMENT|MGMT|LTD|LIMITED|ENTERPRISES|INVESTMENTS|VENTURES|ESTATES)\b/;

/**
 * The grouping key for an owner name: upper case, periods and commas dropped, runs of
 * whitespace collapsed. `Example Realty, L.P.` and `EXAMPLE REALTY LP` share a key; any
 * other difference in spelling is a different owner, because the assessor recorded a
 * different name. Null for a blank name.
 */
export function ownerKey(owner: string | null | undefined): string | null {
  if (owner === null || owner === undefined) return null;
  const key = owner
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // `L L C` and `L P` are what periods leave behind in `L.L.C.` and `L.P.`; written
    // back as one word so the spaced and unspaced spellings group together.
    .replace(/\bL L L P\b/g, 'LLLP')
    .replace(/\bL L C\b/g, 'LLC')
    .replace(/\bL L P\b/g, 'LLP')
    .replace(/\bL P\b/g, 'LP');
  return key === '' ? null : key;
}

/**
 * Whether an owner name reads as an entity rather than a person. Every name that clears the
 * mailing-address gate counts, plus the link-only tokens above. A trustee suffix alone
 * (`DOE JANE TR`) stays a person, exactly as it does for the mailing address.
 */
export function isEntityOwner(owner: string | null | undefined): boolean {
  const key = ownerKey(owner);
  if (key === null) return false;
  return showMailingAddress(key) || LINK_ONLY_ENTITY_TOKEN.test(key);
}

/**
 * Whether an assessment row is a residential parcel, for the two-parcel rule: the seed's own
 * housing filter, plus single-family (R1), which the seed skips but a reviewer can still add.
 */
export function isResidentialAssessment(assessment: Pick<AssessmentPayload, 'landUse' | 'landUseDescription'>): boolean {
  if (isSeedParcelRow({ LU: assessment.landUse, LU_DESC: assessment.landUseDescription })) return true;
  return normalizeLandUse(assessment.landUse) === 'R1';
}

/**
 * The key a building's owner of record would link through, or null when it must not link.
 * `residentialParcels` is how many residential parcels in our data carry the same key,
 * this one included; a caller that has not counted passes 0, which links entities only.
 */
export function linkableOwnerKey(
  assessment: Pick<AssessmentPayload, 'owner' | 'condominium'>,
  residentialParcels: number,
): string | null {
  if (assessment.condominium) return null;
  const key = ownerKey(assessment.owner);
  if (key === null) return null;
  if (isEntityOwner(key)) return key;
  return residentialParcels >= MIN_PARCELS_FOR_PERSON ? key : null;
}
