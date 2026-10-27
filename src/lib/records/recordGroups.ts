// The three groups the public records panel sorts city records into, and the table that puts
// each 311 request type in one of them.
//
// Product rule, non-negotiable: grouping is not judging. A group says what a record is about,
// taken from the request type the city itself recorded. Nothing here ranks one group above
// another, scores a record, or decides that a type is serious. The panel's order (living
// conditions first) follows what a renter asked about, not how bad a record is.
//
// This runs at render time over the stored 311 payloads. It deliberately does not touch the
// pull-time `classification` written by `sources/boston/serviceRequests.ts`: the daily
// fixture check and the scheduler's breaker read that field, so leaving it alone means a
// change to this table can never pause the city-wide fill. The one thing this module takes
// from the pull-time field is a floor: a request the pull calls 'housing' always lands in a
// group, so nothing that used to be listed falls out of the panel.
//
// A leaf module: it imports only types, so a page can import it without pulling the records
// stack in with it.
import type { ServiceRequestPayload } from './types';

export type RecordGroupId = 'living' | 'building' | 'upkeep';

export interface RecordGroup {
  id: RecordGroupId;
  title: string;
  /** One plain line under the group heading saying what is in it. */
  description: string;
}

/** In panel order. The order is the owner's decision, not a ranking of the records. */
export const RECORD_GROUPS: readonly RecordGroup[] = [
  {
    id: 'living',
    title: 'Living conditions',
    description: '311 requests about conditions inside the home: heat, utilities, pests, mold, and living conditions.',
  },
  {
    id: 'building',
    title: 'Building safety and code',
    description: 'ISD violations, 311 building and code requests, and building permits. A permit is a record of permitted work, not a problem.',
  },
  {
    id: 'upkeep',
    title: 'Property upkeep',
    description: 'Public Works code enforcement tickets and 311 requests about trash, sidewalks, dumping, and the condition of the property.',
  },
];

/**
 * 311 request types by group, spelled as the city records them. Built from the distinct
 * reason, subject and type values in Boston's legacy 311 files (2011 to 2026) and the
 * department and service names in the new 311 system, checked against data.boston.gov on
 * 2026-10-27. Matching ignores case, punctuation and repeated spaces, so the legacy file's
 * "Heat - Excessive  Insufficient" and a "Heat - Excessive, Insufficient" spelling are one type.
 *
 * A type not listed here is an "other" request: counted on the panel, never listed. That is
 * where parking, street cleaning, streetlights, missed trash pickups, sidewalk repair and
 * food-establishment complaints stay.
 */
export const SERVICE_REQUEST_TYPE_GROUPS: Readonly<Record<RecordGroupId, readonly string[]>> = {
  living: [
    // Legacy reason "Housing", routed to Inspectional Services.
    'Unsatisfactory Living Conditions',
    'Squalid Living Conditions',
    'Maintenance Complaint - Residential',
    'Rental Unit Delivery Conditions',
    'Heat - Excessive Insufficient',
    'No Utilities Residential - Water',
    'No Utilities Residential - Electricity',
    'No Utilities Residential - Gas',
    'Unsatisfactory Utilities - Electrical Plumbing',
    'Cross Metering - Sub-Metering',
    'Sewage/Septic Back-Up',
    'Pest Infestation - Residential',
    'Mice Infestation - Residential',
    'Bed Bugs',
    'Chronic Dampness/Mold',
    'Poor Ventilation',
    'Carbon Monoxide',
    'Lead',
    'Breathe Easy',
    // Legacy reason "Environmental Services", routed to Inspectional Services. Before October
    // 2026 these were dropped because the pull classifies on the legacy reason alone.
    'Rodent Activity',
    'Rat Bite',
    'Pigeon Infestation',
    // Legacy reason "Building": a danger inside the building, or a maintenance complaint about
    // a home, is a living condition.
    'Unsafe Dangerous Conditions',
    'Maintenance - Homeowner',
  ],
  building: [
    // Legacy reason "Building", routed to Inspectional Services.
    'Building Inspection Request',
    'Work w/out Permit',
    'Exceeding Terms of Permit',
    'Contractors Complaint',
    'Working Beyond Hours',
    'Protection of Adjoining Property',
    'Electrical',
    'Plumbing',
    'Mechanical',
    'Egress',
    'Illegal Occupancy',
    'Illegal Rooming House',
    'Occupying W/Out A Valid CO/CI',
    'Illegal Use',
    'Zoning',
    'ADA',
    // Legacy reason "Housing", but about how a unit is used or occupied rather than its condition.
    'Short Term Rental',
    'Overcrowding',
    'Student Overcrowding',
    // Legacy reason "Environmental Services", routed to Inspectional Services.
    'Abandoned Building',
    'Illegal Auto Body Shop',
  ],
  upkeep: [
    // Legacy reason "Code Enforcement", routed to Public Works (a few to Inspectional Services).
    'Improper Storage of Trash (Barrels)',
    'Poor Conditions of Property',
    'Unshoveled Sidewalk',
    'Snow Removal',
    'Illegal Dumping',
    'Construction Debris',
    'Parking on Front/Back Yards (Illegal Parking)',
    'Illegal Posting of Signs',
    'Illegal Vending',
    // Legacy reason "Environmental Services", routed to Inspectional Services.
    'Overflowing or Un-kept Dumpster',
    'Trash on Vacant Lot',
    // New 311 system, Public Works: the same code enforcement requests under their new names.
    'Improper Trash Storage',
    'Trash Placed Out Early',
    'Illegal Dumping or Disposal',
    'Illegal Yard Parking',
    'Unauthorized Signage',
    'Unauthorized Vending',
    'Overgrown Weeds',
  ],
};

/** Case, punctuation and runs of spaces are not part of a type's identity. */
export function normalizeRequestType(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const GROUP_BY_TYPE: ReadonlyMap<string, RecordGroupId> = new Map(
  (Object.keys(SERVICE_REQUEST_TYPE_GROUPS) as RecordGroupId[]).flatMap((group) =>
    SERVICE_REQUEST_TYPE_GROUPS[group].map((type) => [normalizeRequestType(type), group] as const),
  ),
);

/**
 * Where a request the pull counts as housing goes when its type is not in the table: a
 * legacy reason the city added a new type under. The new 311 system's Inspectional Services
 * department has no reason to go by, so an unlisted type from it is a building and code request.
 */
const HOUSING_REASON_FALLBACK: Readonly<Record<string, RecordGroupId>> = {
  housing: 'living',
  building: 'building',
  'code enforcement': 'upkeep',
};

type GroupableRequest = Pick<ServiceRequestPayload, 'type' | 'title' | 'reason' | 'classification'>;

/**
 * The group a 311 request belongs to, or null for an "other" request. The request type the
 * city recorded decides it; the case title stands in when the type is blank, as it does on
 * the panel's own list.
 */
export function serviceRequestGroup(row: GroupableRequest): RecordGroupId | null {
  const byType = GROUP_BY_TYPE.get(normalizeRequestType(row.type ?? row.title));
  if (byType) return byType;
  if (row.classification !== 'housing') return null;
  return HOUSING_REASON_FALLBACK[normalizeRequestType(row.reason)] ?? 'building';
}

export interface GroupedServiceRequests {
  living: ServiceRequestPayload[];
  building: ServiceRequestPayload[];
  upkeep: ServiceRequestPayload[];
  /** Requests in none of the groups. Counted, never listed. */
  otherCount: number;
}

/** Newest first by the date the request was opened; plain string comparison, see below. */
function byOpenedDesc(a: ServiceRequestPayload, b: ServiceRequestPayload): number {
  // Not localeCompare: these are ISO-ish date strings, and locale collation would make the
  // order depend on the runtime's ICU data.
  const left = a.openedAt ?? '';
  const right = b.openedAt ?? '';
  return left < right ? 1 : left > right ? -1 : 0;
}

/** Every stored request, each in exactly one group or counted as other. */
export function groupServiceRequests(rows: readonly ServiceRequestPayload[]): GroupedServiceRequests {
  const grouped: GroupedServiceRequests = { living: [], building: [], upkeep: [], otherCount: 0 };
  for (const row of rows) {
    const group = serviceRequestGroup(row);
    if (group === null) grouped.otherCount += 1;
    else grouped[group].push(row);
  }
  grouped.living.sort(byOpenedDesc);
  grouped.building.sort(byOpenedDesc);
  grouped.upkeep.sort(byOpenedDesc);
  return grouped;
}
