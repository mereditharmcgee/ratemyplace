import { describe, expect, it } from 'vitest';
import {
  ANALYZE_BOSTON_URL,
  BOSTON_OPEN_DATA_LICENSE,
  recordsCitations,
  resourceUrl,
} from '../records/provenance';
import { pulledFromLine, rowPulledLabel } from '../records/display';
import { sourcesForCity } from '../records/jurisdictions';
import { ASSESSOR_YEARS, FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { LEGACY_311_RESOURCES, NEW_311_RESOURCE_ID } from '../records/sources/boston/serviceRequests';

const BOSTON_SOURCES = sourcesForCity('Boston');
const ALL_SOURCE_IDS = BOSTON_SOURCES.map((source) => source.id);

/** Every link in a citation list, flattened. */
function allLinks(ids: Iterable<string>) {
  return recordsCitations(ids).flatMap((citation) => citation.resources);
}

describe('recordsCitations', () => {
  it('cites the six Boston datasets in the order the pull runs them', () => {
    expect(recordsCitations(ALL_SOURCE_IDS).map((citation) => citation.title)).toEqual([
      'Property Assessment',
      'Approved Building Permits',
      'Building and Property Violations',
      'Public Works Violations',
      '311 Service Requests',
      'RentSmart',
    ]);
  });

  it('links every resource at the resource level on Analyze Boston, never the dataset page', () => {
    for (const link of allLinks(ALL_SOURCE_IDS)) {
      expect(link.url).toMatch(
        /^https:\/\/data\.boston\.gov\/dataset\/[a-z0-9-]+\/resource\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it('links each resource under the dataset page its own source module names', () => {
    // Every source id a pull can store, and the dataset page that source cites today.
    const links = allLinks(ALL_SOURCE_IDS);
    for (const source of BOSTON_SOURCES) {
      expect(source.pageUrl).not.toBeNull();
      expect(links.some((link) => link.url === resourceUrl(source.pageUrl!, source.id))).toBe(true);
    }
  });

  it('cites every 311 file a pull queries: each yearly file, newest first, then the new system', () => {
    const serviceRequests = recordsCitations([NEW_311_RESOURCE_ID]);

    expect(serviceRequests).toHaveLength(1);
    const { resources } = serviceRequests[0];
    expect(resources.map((link) => link.label)).toEqual([
      ...LEGACY_311_RESOURCES.map((resource) => String(resource.year)),
      'new system',
    ]);
    expect(resources.map((link) => link.url.split('/resource/')[1])).toEqual([
      ...LEGACY_311_RESOURCES.map((resource) => resource.resourceId),
      NEW_311_RESOURCE_ID,
    ]);
    // A bare year is a poor link name on its own; the accessible name says which dataset it is.
    expect(resources[0].name).toBe(`311 Service Requests ${LEGACY_311_RESOURCES[0].year}`);
  });

  it('lists only the assessor years that were pulled, newest first', () => {
    const [assessor] = recordsCitations([ASSESSOR_YEARS[2].resourceId, FY2026_RESOURCE_ID]);

    expect(assessor.title).toBe('Property Assessment');
    expect(assessor.resources.map((link) => link.label)).toEqual([
      ASSESSOR_YEARS[0].fiscalYear,
      ASSESSOR_YEARS[2].fiscalYear,
    ]);
    expect(assessor.resources[0].name).toBe(`Property Assessment ${ASSESSOR_YEARS[0].fiscalYear}`);
  });

  it('cites only the assessor year on a seeded building that has nothing deeper', () => {
    const citations = recordsCitations([FY2026_RESOURCE_ID]);

    expect(citations).toHaveLength(1);
    expect(citations[0].resources).toEqual([
      {
        label: 'FY2026',
        name: 'Property Assessment FY2026',
        url: `https://data.boston.gov/dataset/property-assessment/resource/${FY2026_RESOURCE_ID}`,
      },
    ]);
  });

  it('names a single-resource dataset by its title, with no year label', () => {
    const [permits] = recordsCitations([PERMITS_RESOURCE_ID]);

    expect(permits.resources).toEqual([
      {
        label: null,
        name: 'Approved Building Permits',
        url: `https://data.boston.gov/dataset/approved-building-permits/resource/${PERMITS_RESOURCE_ID}`,
      },
    ]);
  });

  it('leaves out a source id this build does not know rather than citing it as something else', () => {
    expect(recordsCitations(['00000000-0000-0000-0000-000000000000'])).toEqual([]);
    expect(recordsCitations([])).toEqual([]);
  });

  it('never lists the same resource twice', () => {
    const urls = allLinks(ALL_SOURCE_IDS).map((link) => link.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('resourceUrl', () => {
  it('appends the resource path to a dataset page, with or without a trailing slash', () => {
    expect(resourceUrl('https://data.boston.gov/dataset/rentsmart', 'abc')).toBe(
      'https://data.boston.gov/dataset/rentsmart/resource/abc',
    );
    expect(resourceUrl('https://data.boston.gov/dataset/rentsmart/', 'abc')).toBe(
      'https://data.boston.gov/dataset/rentsmart/resource/abc',
    );
  });
});

describe('the credit line', () => {
  it('states the license CKAN reports for the Boston packages, with a link to it', () => {
    expect(BOSTON_OPEN_DATA_LICENSE.title).toBe('Open Data Commons Public Domain Dedication and License (PDDL)');
    expect(BOSTON_OPEN_DATA_LICENSE.url).toBe('https://opendatacommons.org/licenses/pddl/');
    expect(ANALYZE_BOSTON_URL).toBe('https://data.boston.gov/');
  });
});

describe('pull dates', () => {
  // 2026-09-12 16:00 UTC is noon in Boston, so the date reads the same in either zone.
  const SEPT_12 = Date.UTC(2026, 8, 12, 16) / 1000;

  it('says the date is when the records were pulled, not the city dataset date', () => {
    expect(pulledFromLine(SEPT_12)).toBe('Pulled from City of Boston open data on Sep 12, 2026.');
    expect(rowPulledLabel(SEPT_12)).toBe('pulled Sep 12, 2026');
  });

  it('dates a late-evening Boston pull to its Boston day', () => {
    // 2026-09-13 01:30 UTC is 9:30 pm on Sep 12 in Boston.
    expect(rowPulledLabel(Date.UTC(2026, 8, 13, 1, 30) / 1000)).toBe('pulled Sep 12, 2026');
  });
});
