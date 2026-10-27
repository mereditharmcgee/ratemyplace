// Where the public records panel's data comes from.
//
// The citations are built only from the code constants the pull itself queries
// (`sources/boston/*.ts`), so the list cannot name a resource the pull does not use, and a
// resource id that changes there changes here with it. Each link goes to the resource, not the
// dataset: the 311 dataset holds sixteen yearly files plus the new-system file, and a dataset
// link cannot say which of them a count came from.
//
// The license is what CKAN's `package_show` returned for all six packages on 2026-10-27:
// `license_id` odc-pddl, `license_title` "Open Data Commons Public Domain Dedication and License
// (PDDL)". If a package ever reports a different license, the panel's one-line credit is no
// longer true for every link under it, and this file is where that has to be said.
import { ASSESSOR_PAGE_URL, ASSESSOR_YEARS } from './sources/boston/assessor';
import { ENFORCEMENT_PAGE_URL, ENFORCEMENT_RESOURCE_ID } from './sources/boston/enforcement';
import { PERMITS_PAGE_URL, PERMITS_RESOURCE_ID } from './sources/boston/permits';
import { RENTSMART_PAGE_URL, RENTSMART_RESOURCE_ID } from './sources/boston/rentsmart';
import {
  LEGACY_311_RESOURCES,
  NEW_311_RESOURCE_ID,
  SERVICE_REQUESTS_PAGE_URL,
} from './sources/boston/serviceRequests';
import { VIOLATIONS_PAGE_URL, VIOLATIONS_RESOURCE_ID } from './sources/boston/violations';

/** The City of Boston's open data site, which publishes every dataset the panel reads. */
export const ANALYZE_BOSTON_URL = 'https://data.boston.gov/';

/** The license every Boston package the panel reads is published under (see the note above). */
export const BOSTON_OPEN_DATA_LICENSE = Object.freeze({
  title: 'Open Data Commons Public Domain Dedication and License (PDDL)',
  url: 'https://opendatacommons.org/licenses/pddl/',
});

export interface ResourceLink {
  /** The link text: a fiscal or calendar year, or null for a dataset's only resource. */
  label: string | null;
  /** The accessible name, which says which dataset a bare year belongs to. */
  name: string;
  url: string;
}

export interface DatasetCitation {
  /** The dataset's title as Analyze Boston lists it. */
  title: string;
  resources: ResourceLink[];
}

/** A resource-level page on Analyze Boston: `<dataset page>/resource/<resource id>`. */
export function resourceUrl(datasetUrl: string, resourceId: string): string {
  return `${datasetUrl.replace(/\/+$/, '')}/resource/${resourceId}`;
}

function onlyResource(title: string, datasetUrl: string, resourceId: string): ResourceLink {
  return { label: null, name: title, url: resourceUrl(datasetUrl, resourceId) };
}

function yearResource(title: string, label: string, datasetUrl: string, resourceId: string): ResourceLink {
  return { label, name: `${title} ${label}`, url: resourceUrl(datasetUrl, resourceId) };
}

const ASSESSOR_TITLE = 'Property Assessment';
const PERMITS_TITLE = 'Approved Building Permits';
const VIOLATIONS_TITLE = 'Building and Property Violations';
const ENFORCEMENT_TITLE = 'Public Works Violations';
const SERVICE_REQUESTS_TITLE = '311 Service Requests';
const RENTSMART_TITLE = 'RentSmart';

/** What a building's 311 pull queries: every yearly file, newest first, then the new system. */
const SERVICE_REQUEST_RESOURCES: ResourceLink[] = [
  ...LEGACY_311_RESOURCES.map(({ year, resourceId }) =>
    yearResource(SERVICE_REQUESTS_TITLE, String(year), SERVICE_REQUESTS_PAGE_URL, resourceId),
  ),
  yearResource(SERVICE_REQUESTS_TITLE, 'new system', SERVICE_REQUESTS_PAGE_URL, NEW_311_RESOURCE_ID),
];

/**
 * The datasets behind a building's panel, in the order the pull runs them, each with the
 * resources it read. `pulledSourceIds` is the set of source ids with a stored pull for the
 * building (the keys of `BuildingRecordsView.sources`), so a seeded building that has only its
 * FY2026 assessor row cites only that, and a source id this build does not know is left out
 * rather than cited as something it is not.
 *
 * The assessor is one source per fiscal year, so its years are listed from the pulls. 311 is
 * one source that queries seventeen resources on every pull, so a 311 pull cites all of them.
 */
export function recordsCitations(pulledSourceIds: Iterable<string>): DatasetCitation[] {
  const pulled = new Set(pulledSourceIds);
  const citations: DatasetCitation[] = [];

  const assessorYears = ASSESSOR_YEARS.filter((year) => pulled.has(year.resourceId));
  if (assessorYears.length > 0) {
    citations.push({
      title: ASSESSOR_TITLE,
      resources: assessorYears.map((year) =>
        yearResource(ASSESSOR_TITLE, year.fiscalYear, ASSESSOR_PAGE_URL, year.resourceId),
      ),
    });
  }
  if (pulled.has(PERMITS_RESOURCE_ID)) {
    citations.push({ title: PERMITS_TITLE, resources: [onlyResource(PERMITS_TITLE, PERMITS_PAGE_URL, PERMITS_RESOURCE_ID)] });
  }
  if (pulled.has(VIOLATIONS_RESOURCE_ID)) {
    citations.push({
      title: VIOLATIONS_TITLE,
      resources: [onlyResource(VIOLATIONS_TITLE, VIOLATIONS_PAGE_URL, VIOLATIONS_RESOURCE_ID)],
    });
  }
  if (pulled.has(ENFORCEMENT_RESOURCE_ID)) {
    citations.push({
      title: ENFORCEMENT_TITLE,
      resources: [onlyResource(ENFORCEMENT_TITLE, ENFORCEMENT_PAGE_URL, ENFORCEMENT_RESOURCE_ID)],
    });
  }
  if (pulled.has(NEW_311_RESOURCE_ID)) {
    citations.push({ title: SERVICE_REQUESTS_TITLE, resources: SERVICE_REQUEST_RESOURCES });
  }
  if (pulled.has(RENTSMART_RESOURCE_ID)) {
    citations.push({
      title: RENTSMART_TITLE,
      resources: [onlyResource(RENTSMART_TITLE, RENTSMART_PAGE_URL, RENTSMART_RESOURCE_ID)],
    });
  }
  return citations;
}
