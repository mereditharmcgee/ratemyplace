// Rules for linking an assessor owner of record to the other buildings recorded under the
// same name. Pure functions only: nothing here reads the database. `owners.ts` writes the
// row these functions compute into `building_owners` during a pull, the owners backfill
// writes the same row from stored payloads, and `ownerList.ts` reads it back for the panel
// link, the list page and landlord search (see
// docs/superpowers/specs/2026-10-27-owner-of-record-list-design.md).
//
// Three rules, each a guardrail rather than a formatting choice:
// 1. Group by the exact owner name only, normalized for case, spacing and punctuation.
//    Never by tax mailing address: a shared mailing address suggests who manages a
//    property, it is not a record of who owns it.
// 2. An owner that reads as a business (LLC, LP, REALTY, ...) can be linked. A person can be
//    linked only when two or more residential parcels in our data carry the same name, so no
//    list is built for someone who owns one home. A family, nominee or other personal trust
//    (`DOE FAMILY TRUST`) is held to the person rule, because many homes are held that way.
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
 * Words that name a trust without naming a business: TRUST, FAMILY, NOMINEE and the trustee
 * suffixes the mailing-address gate knows. In Massachusetts many owner-occupied homes are held
 * in a family, nominee or revocable trust (`DOE FAMILY TRUST`, `DOE JANE REVOCABLE TRUST`), so
 * a name whose only entity words are these is a person for linking: it needs two or more
 * residential parcels here, like any person. A trust that also names a business
 * (`EXAMPLE REALTY TRUST`, `EXAMPLE HOLDINGS TRUST`) is still an entity. Linking only: the
 * mailing-address gate in `display.ts` is unchanged.
 */
const PERSONAL_TRUST_WORDS = /\b(TRUST|FAMILY|NOMINEE|TR|TRS|TRUSTEE|TRUSTEES|TRSTEE|TRSTEES)\b/g;

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
 * Whether an owner name reads as a business rather than a person, for linking. The personal
 * trust words above come out first, and what is left has to clear the mailing-address gate or
 * carry a link-only token. So `DOE JANE TR`, `DOE FAMILY TRUST` and `12 EXAMPLE RD NOMINEE
 * TRUST` are persons, and `EXAMPLE REALTY TRUST` is an entity. Never true for a name the
 * gate and the link-only tokens would both refuse.
 */
export function isEntityOwner(owner: string | null | undefined): boolean {
  const key = ownerKey(owner);
  if (key === null) return false;
  // A `-` holds each removed word's place, so the words either side of it cannot join into a
  // new entity phrase (`CITY TRUST OF` must not become `CITY OF`).
  const rest = key.replace(PERSONAL_TRUST_WORDS, '-');
  return showMailingAddress(rest) || LINK_ONLY_ENTITY_TOKEN.test(rest);
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
 * The list endpoint and landlord search apply this to a typed key too, not only the panel
 * link: a key normalizes to itself, so `{ owner: key, condominium: false }` gates it.
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

/**
 * One `building_owners` row: the owner of record off one assessor row, with every derived
 * column the list, the panel link and landlord search read. Both writers build it here, the
 * pull (`owners.ts`) and the owners backfill, so the two cannot compute a different key.
 */
export interface OwnerRow {
  buildingId: string;
  fiscalYear: string;
  parcelId: string | null;
  /** As the assessor recorded it, trimmed. */
  owner: string;
  ownerKey: string;
  isEntity: 0 | 1;
  residential: 0 | 1;
}

/**
 * The owner row for a building's assessor row, or null when there is nothing to link: a
 * condominium parcel (no single owner of record is shown, so none is stored) or a blank owner.
 */
export function ownerRowFromAssessment(
  buildingId: string,
  assessment: Pick<AssessmentPayload, 'fiscalYear' | 'parcelId' | 'owner' | 'condominium' | 'landUse' | 'landUseDescription'>,
): OwnerRow | null {
  if (assessment.condominium) return null;
  const owner = assessment.owner?.trim() ?? '';
  const key = ownerKey(owner);
  if (key === null) return null;
  return {
    buildingId,
    fiscalYear: assessment.fiscalYear,
    parcelId: assessment.parcelId?.trim() || null,
    owner,
    ownerKey: key,
    isEntity: isEntityOwner(key) ? 1 : 0,
    residential: isResidentialAssessment(assessment) ? 1 : 0,
  };
}
