import type { AssessmentPayload } from '../types';

/** One assessor row as CKAN returns it: strings, numbers, or null; never assume which. */
export type AssessorRow = Record<string, unknown>;

/** The SAM columns the seed reads. */
export interface SamRow {
  SAM_ADDRESS_ID: string | number | null;
  RELATIONSHIP_TYPE: string | number | null;
  PARCEL_ID: string | number | null;
  MAILING_NEIGHBORHOOD: string | null;
  ZIP_CODE: string | number | null;
  POINT_X: string | number | null;
  POINT_Y: string | number | null;
  UNIT: string | null;
}

/** What the seed keeps from SAM for one parcel: its primary address point. */
export interface SamPoint {
  samId: string;
  latitude: number;
  longitude: number;
  neighborhood: string | null;
  zip: string | null;
}

/** One building to write, fully derived, before any SQL. */
export interface SeedBuilding {
  parcelId: string;
  address: string;
  streetKey: string;
  numLo: number;
  numHi: number;
  neighborhood: string | null;
  zip: string | null;
  unitCount: number | null;
  yearBuilt: number | null;
  buildingType: string;
  latitude: number | null;
  longitude: number | null;
  samId: string | null;
  assessment: AssessmentPayload;
}

/** A production building row as the script loads it. */
export interface ExistingBuilding {
  id: string;
  address: string;
  slug: string;
  parcel_id: string | null;
  latitude: number | null;
  longitude: number | null;
  /** As stored, in any shape: the matcher normalizes it before comparing. */
  zip_code: string | null;
}
