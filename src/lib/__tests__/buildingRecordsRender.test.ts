import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import BuildingRecords from '../../components/BuildingRecords.astro';
import { pullBuildingRecords } from '../records/pull';
import type { BuildingRowForIdentity } from '../records/identity';
import { ASSESSOR_YEARS, FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { VIOLATIONS_RESOURCE_ID } from '../records/sources/boston/violations';
import { ENFORCEMENT_RESOURCE_ID } from '../records/sources/boston/enforcement';
import { LEGACY_311_RESOURCES, NEW_311_RESOURCE_ID } from '../records/sources/boston/serviceRequests';
import {
  CONDOMINIUM_COPY,
  DECLARED_VALUATION_CAVEAT,
  FILL_QUEUED_COPY,
  NO_VIOLATIONS_CAVEAT,
  PERMIT_COVERAGE_NOTE,
  GROUPING_LINK_TEXT,
  GROUPING_NOTE,
  REFRESH_BUTTON_LABEL,
  REFRESH_REQUESTED_COPY,
  REQUESTED_COPY,
  REQUEST_BUTTON_HELP,
  REQUEST_BUTTON_LABEL,
  REQUEST_PARKED_COPY,
  SHOW_LESS_LABEL,
  STALE_PULL_NOTE,
  STILL_OPEN_NOTE,
} from '../records/display';
import { ROW_CAP } from '../records/ckan';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding, insertPull } from './helpers/recordsDb';
import { MAX_ATTEMPTS, enqueue } from '../records/queue';
import { fixtureFetch, type FixtureRoute } from './helpers/records/fixtureFetch';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';
import lanark2025 from './helpers/records/assessor-fy2025-lanark.json';
import condo2026 from './helpers/records/assessor-fy2026-condo.json';
import permitsPositive from './helpers/records/permits-positive.json';
import legacy311 from './helpers/records/311-2024-lanark.json';
import new311 from './helpers/records/311-new-lanark.json';
import enforcementRows from './helpers/records/enforcement-lanark.json';

/** The assessor's previous fiscal year, so the value series has two points to draw between. */
const FY2025_RESOURCE_ID = ASSESSOR_YEARS[1].resourceId;
const LEGACY_2024_RESOURCE_ID = LEGACY_311_RESOURCES.find((resource) => resource.year === 2024)!.resourceId;
const LEGACY_2013_RESOURCE_ID = LEGACY_311_RESOURCES.find((resource) => resource.year === 2013)!.resourceId;
const LEGACY_2023_RESOURCE_ID = LEGACY_311_RESOURCES.find((resource) => resource.year === 2023)!.resourceId;

/**
 * The panel's privacy and empty-state rules, checked against the HTML the server actually
 * emits rather than against the helpers underneath it. `display.ts` deciding to withhold a
 * mailing address is worth nothing if the template renders the field anyway, and only a
 * render can tell the two apart.
 *
 * The whole component renders here, island and all: `BuildingRecords.astro` mounts
 * `RecordCorrectionForm` with `client:visible`, so the container needs the React renderer
 * registered the way `namedPartySsrVisibility.test.ts` does it.
 */

const suite = sqliteAvailable ? describe : describe.skip;

const ADMIN_ID = 'admin-render';
const BUILDING_ID = 'bldg-lanark';

/** A string no source or copy constant contains, so finding it in the HTML can only mean one thing. */
const UPSTREAM_ERROR_TEXT = 'ZZZ-INTERNAL-ZZZ';

type AssessorRow = Record<string, unknown>;

async function createDbWithAdmin(): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  await db
    .prepare('INSERT INTO users (id, email, is_admin) VALUES (?, ?, 1)')
    .bind(ADMIN_ID, 'admin@example.com')
    .run();
  return db;
}

async function loadBuilding(db: TestD1Database, id: string): Promise<BuildingRowForIdentity> {
  const row = await db
    .prepare('SELECT id, address, city, state, zip_code, parcel_id, sam_id FROM buildings WHERE id = ?')
    .bind(id)
    .first<BuildingRowForIdentity>();
  if (!row) throw new Error(`test building ${id} was not inserted`);
  return row;
}

/** Seed a building with one real pull: FY2026 answers with `assessorRows`, plus whatever else `routes` adds. */
async function seedPulledBuilding(
  db: TestD1Database,
  assessorRows: AssessorRow[],
  routes: FixtureRoute[] = [],
): Promise<void> {
  await insertBuilding(db, { id: BUILDING_ID, parcel_id: '2102098000' });
  const building = await loadBuilding(db, BUILDING_ID);
  await pullBuildingRecords(db, building, {
    triggeredBy: ADMIN_ID,
    fetchImpl: fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: assessorRows }, ...routes]),
  });
}

async function renderPanel(db: TestD1Database, buildingId = BUILDING_ID): Promise<string> {
  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });

  return container.renderToString(BuildingRecords, {
    props: { buildingId },
    request: new Request(`https://ratemyplace.org/building/${buildingId}`),
    locals: {
      user: null,
      session: null,
      runtime: { env: { DB: db } },
    } as unknown as App.Locals,
    partial: true,
  });
}

function parse(html: string): HTMLElement {
  const fragment = document.createElement('div');
  fragment.innerHTML = html;
  return fragment;
}

/**
 * The ledger row for a given source, so a count or an empty state can be attributed to the
 * right one. Each row is a `<details>` whose `<summary>` carries the `h4` (the groups are `h3`).
 */
function ledgerRow(html: string, heading: string): HTMLDetailsElement {
  const fragment = parse(html);
  const headings = Array.from(fragment.querySelectorAll('summary h4'));
  const match = headings.find((node) => (node.textContent ?? '').trim().startsWith(heading));
  if (!match) throw new Error(`Rendered panel has no "${heading}" ledger row`);
  const row = match.closest('details');
  if (!row) throw new Error(`"${heading}" heading is not inside a ledger row`);
  return row as HTMLDetailsElement;
}

/** The text of one ledger row, summary and body together. */
function sectionText(html: string, heading: string): string {
  return ledgerRow(html, heading).textContent ?? '';
}

suite('BuildingRecords.astro rendered output', () => {
  it('renders an entity owner with its tax mailing address', async () => {
    const db = await createDbWithAdmin();
    await seedPulledBuilding(db, lanark2026 as AssessorRow[]);

    const html = await renderPanel(db);

    expect(html).toContain('id="public-records"');
    expect(html).toContain('LANARK ROAD LLC MASS LLC');
    expect(html).toContain('PO BOX 35006');
    // The correction form's Turnstile script rides with the panel, not with the page.
    expect(html).toContain('challenges.cloudflare.com/turnstile');
  });

  it('never prints the person an entity lists as its addressee', async () => {
    const db = await createDbWithAdmin();
    await seedPulledBuilding(db, lanark2026 as AssessorRow[]);

    const html = await renderPanel(db);

    // The entity's own address is published (above); the human being named on it is not.
    expect(html).not.toContain('DENNIS CLAIR');
    expect(html).not.toContain('C/O ATT');
  });

  it('withholds the mailing address of an individual owner', async () => {
    const db = await createDbWithAdmin();
    await seedPulledBuilding(db, [
      {
        ...(lanark2026[0] as AssessorRow),
        OWNER: 'PASCUCCI CARLO',
        MAIL_ADDRESSEE: null,
        MAIL_STREET_ADDRESS: '195 LEXINGTON ST',
      },
    ]);

    const html = await renderPanel(db);

    // The owner of record is public information. Where that person receives mail is a
    // home address, and no amount of it may reach the page — not the street, not the label.
    expect(html).toContain('PASCUCCI CARLO');
    expect(html).not.toContain('195 LEXINGTON ST');
    expect(html).not.toContain('Tax mailing address');
  });

  it("never renders an errored source's upstream error text", async () => {
    const db = await createDbWithAdmin();
    await seedPulledBuilding(db, lanark2026 as AssessorRow[], [
      { resourceId: PERMITS_RESOURCE_ID, errorStatus: 503, errorMessage: UPSTREAM_ERROR_TEXT },
    ]);

    // The message really is stored — this test is about the panel, not the pull.
    const pull = await db
      .prepare('SELECT status, error_message FROM record_pulls WHERE building_id = ? AND source_id = ?')
      .bind(BUILDING_ID, PERMITS_RESOURCE_ID)
      .first<{ status: string; error_message: string | null }>();
    expect(pull?.status).toBe('error');
    expect(pull?.error_message).toContain(UPSTREAM_ERROR_TEXT);

    const html = await renderPanel(db);

    expect(html).not.toContain(UPSTREAM_ERROR_TEXT);
    // What the reader gets instead: the fact of the failure and when it was tried.
    expect(sectionText(html, 'Building permits')).toContain('Record unavailable');
  });

  it('distinguishes a source that was never pulled from one that came back empty', async () => {
    const db = await createDbWithAdmin();
    await seedPulledBuilding(db, lanark2026 as AssessorRow[]);
    // Drop the violations provenance row, leaving the source in the state a build that
    // predates it would produce: never queried for this building. It stored no rows, so
    // nothing references the pull row being deleted.
    await db
      .prepare('DELETE FROM record_pulls WHERE building_id = ? AND source_id = ?')
      .bind(BUILDING_ID, VIOLATIONS_RESOURCE_ID)
      .run();

    const html = await renderPanel(db);
    const violations = sectionText(html, 'ISD violation cases');

    expect(violations).toContain('Not retrieved yet');
    // "No violations on record" is a finding. Nobody looked, so there is no finding.
    expect(violations).not.toContain('No violations on record');
    expect(html).not.toContain('No violations on record');
  });

  it('renders no panel at all for a building that has never been pulled', async () => {
    const db = await createDbWithAdmin();
    await insertBuilding(db, { id: 'bldg-unpulled' });

    const html = await renderPanel(db, 'bldg-unpulled');

    expect(html).not.toContain('id="public-records"');
    expect(html.trim()).not.toContain('Public records');
    // No panel means no correction form, so the page pays for no Turnstile script either.
    expect(html).not.toContain('challenges.cloudflare.com/turnstile');
  });
});

/**
 * The redesigned panel: a facts strip over a ledger of four sources. These assertions are
 * about the shape a reader meets first — the counts on the closed rows, which row opens by
 * default, and the fact that the full lists are still one disclosure away rather than gone.
 */
suite('BuildingRecords.astro ledger', () => {
  /** Two assessor years plus permits, 311 (legacy and new), and code enforcement. */
  async function seedFullBuilding(db: TestD1Database, extraRoutes: FixtureRoute[] = []): Promise<void> {
    await seedPulledBuilding(db, lanark2026 as AssessorRow[], [
      { resourceId: FY2025_RESOURCE_ID, records: lanark2025 as AssessorRow[] },
      { resourceId: PERMITS_RESOURCE_ID, records: permitsPositive as AssessorRow[] },
      { resourceId: LEGACY_2024_RESOURCE_ID, records: legacy311 as AssessorRow[] },
      { resourceId: NEW_311_RESOURCE_ID, records: new311 as AssessorRow[] },
      { resourceId: ENFORCEMENT_RESOURCE_ID, records: enforcementRows as AssessorRow[] },
      ...extraRoutes,
    ]);
  }

  /** One open and one closed ISD violation, synthetic, so the violations row has an open case to word. */
  const OPEN_VIOLATION_ROUTE: FixtureRoute = {
    resourceId: VIOLATIONS_RESOURCE_ID,
    records: [
      {
        case_no: 'V100001', code: '780', value: null, description: 'Example code line A',
        status: 'Open', status_dttm: '2017-05-09 09:00:00',
        violation_stno: '12', violation_sthigh: null, violation_street: 'Example', violation_suffix: 'RD',
        contact_addr1: null, sam_id: null,
      },
      {
        case_no: 'V100002', code: '110', value: null, description: 'Example code line B',
        status: 'Closed', status_dttm: '2017-05-09 09:00:00',
        violation_stno: '12', violation_sthigh: null, violation_street: 'Example', violation_suffix: 'RD',
        contact_addr1: null, sam_id: null,
      },
    ],
  };

  function summaryText(html: string, heading: string): string {
    return ledgerRow(html, heading).querySelector('summary')?.textContent ?? '';
  }

  it('heads the panel with the jurisdiction and the pull date', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);
    const heading = parse(html).querySelector('#public-records h2');
    const line = heading?.nextElementSibling?.textContent ?? '';

    // Said as when this site pulled the records, not as the city dataset's own date.
    expect(line).toMatch(/^Pulled from City of Boston open data on [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/);
    // A fresh pull carries no stale note.
    expect(line).not.toContain(STALE_PULL_NOTE);
    // The correction link is the panel's one call to action and has to be tappable.
    expect(html).toMatch(/href="#report-record"[^>]*min-h-\[44px\]/);
  });

  it('notes beside the pull date when the stored pull is more than 30 days old', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);
    await db
      .prepare('UPDATE record_pulls SET retrieved_at = retrieved_at - ? WHERE building_id = ?')
      .bind(31 * 86_400, BUILDING_ID)
      .run();

    const html = await renderPanel(db);
    const line = parse(html).querySelector('#public-records h2')?.nextElementSibling?.textContent ?? '';

    expect(line).toMatch(/^Pulled from City of Boston open data on .+\. The city may have added records since then\.$/);
    expect(line).toContain(STALE_PULL_NOTE);
  });

  it('dates each row to the pull that fetched it, in the same words', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const summary = ledgerRow(await renderPanel(db), 'Building permits').querySelector('summary')?.textContent ?? '';

    expect(summary).toMatch(/pulled [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    expect(summary).not.toContain('as of');
  });

  it('credits the city and Analyze Boston, states the license, and links each resource used', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);
    const sources = parse(html).querySelector('#records-sources');
    const text = (sources?.textContent ?? '').replace(/\s+/g, ' ');

    expect(sources?.querySelector('h3')?.textContent).toBe('Sources');
    expect(text).toContain(
      'Data from the City of Boston, published on Analyze Boston (data.boston.gov) under the Open Data Commons Public Domain Dedication and License (PDDL).',
    );
    const hrefs = Array.from(sources?.querySelectorAll('a') ?? []).map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('https://data.boston.gov/');
    expect(hrefs).toContain('https://opendatacommons.org/licenses/pddl/');
    // Resource-level links, not dataset pages: the assessor years, permits, and every 311 file.
    expect(hrefs).toContain(`https://data.boston.gov/dataset/property-assessment/resource/${FY2026_RESOURCE_ID}`);
    expect(hrefs).toContain(`https://data.boston.gov/dataset/property-assessment/resource/${FY2025_RESOURCE_ID}`);
    expect(hrefs).toContain(`https://data.boston.gov/dataset/approved-building-permits/resource/${PERMITS_RESOURCE_ID}`);
    for (const { resourceId } of LEGACY_311_RESOURCES) {
      expect(hrefs).toContain(`https://data.boston.gov/dataset/311-service-requests/resource/${resourceId}`);
    }
    expect(hrefs).toContain(`https://data.boston.gov/dataset/311-service-requests/resource/${NEW_311_RESOURCE_ID}`);
    expect(hrefs.some((href) => href?.endsWith('/dataset/311-service-requests'))).toBe(false);
    // A bare year link names its dataset for a screen reader.
    const year2024 = Array.from(sources?.querySelectorAll('a') ?? []).find((link) => link.textContent === '2024');
    expect(year2024?.getAttribute('aria-label')).toBe('311 Service Requests 2024');
    // Every source link opens the city's page without handing it this page as an opener.
    for (const link of Array.from(sources?.querySelectorAll('a') ?? [])) {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('keeps the record-error form folded until a reader asks for it', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);
    const report = parse(html).querySelector('#report-record');

    // A closed <details>: the heading is the summary, the form waits inside it.
    expect(report?.tagName).toBe('DETAILS');
    expect(report?.hasAttribute('open')).toBe(false);
    expect(report?.querySelector('summary h3')?.textContent?.trim()).toBe('Report a record error');
    expect(report?.querySelector('summary')?.className).toContain('min-h-[44px]');
    // The island hydrates when it scrolls into view, so its Turnstile renders only then.
    expect(report?.querySelector('astro-island')?.getAttribute('client')).toBe('visible');
    // The header link is still the way in, and still a 44px target.
    expect(html).toMatch(/href="#report-record"[^>]*min-h-\[44px\]/);
  });

  it('renders the assessor facts as a definition list of labelled cells', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);
    const strip = parse(html).querySelector('dl');

    // Four facts off one record: terms and descriptions, not four findings in four boxes.
    expect(strip).toBeTruthy();
    expect(Array.from(strip!.querySelectorAll('dt')).map((node) => node.textContent?.trim())).toEqual([
      'Owner of record',
      'Built',
      'Assessed value',
      'Land use',
    ]);
    expect(strip!.querySelectorAll('dd')).toHaveLength(4);

    expect(html).toContain('LANARK ROAD LLC MASS LLC');
    expect(html).toContain('Assessor FY2026 · parcel 2102098000');
    expect(html).toContain('Built');
    expect(html).toContain('1920');
    // Says whose field is blank, so it does not read against a unit count in Building details.
    expect(html).toContain('Last remodel 1980 · units not recorded by the assessor');
    expect(html).toContain('Land use');
    expect(html).toContain('APT 7-30 UNITS');
    // Compact, not the long form, so the four cells fit across a phone.
    expect(html).toContain('$6.72M');
  });

  it('draws a sparkline across the fiscal years and states the range under it', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    expect(html).toContain('<polyline');
    expect(html).toContain('FY2025–FY2026, range $6.53M–$6.72M');
  });

  it('counts each source on its closed ledger row', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    // Two living-conditions requests, one still open. The two trash-storage requests are
    // property upkeep, and the four requests in no group are counted once, under the groups.
    const living = summaryText(html, '311 living conditions requests');
    expect(living).toContain('1 open');
    expect(living).toContain('2024–2026');
    expect(living).not.toContain('not shown');
    const upkeep = summaryText(html, '311 property upkeep requests');
    expect(upkeep).toContain('2 open');
    expect(upkeep).toContain('2024');
    expect(summaryText(html, '311 building and code requests')).toContain('none on record');
    expect(parse(html).textContent).toContain('4 other 311 requests at or near this address');

    // Two Public Works tickets, though the feed holds three violation lines.
    const tickets = summaryText(html, 'Public Works code enforcement tickets');
    expect(tickets).toContain('3 violation lines on 2 tickets');

    // Two permits after the duplicate row is deduped, one open, $36,500 + $1,200 declared.
    const permits = summaryText(html, 'Building permits');
    expect(permits).toContain('1 open · $37.7K declared');
    // The coverage label is the years the permits actually fall in (2019 and 2021) — not the
    // feed's documented coverage window the bars are drawn across, which runs 2006 to 2026.
    expect(permits).toContain('2019–2021');
    // The body names the feed's start as the feed's, so it does not read as a second span for
    // this building's permits.
    const permitsBody = sectionText(html, 'Building permits');
    expect(permitsBody).toContain(PERMIT_COVERAGE_NOTE);
    expect(permitsBody).not.toContain('On record from');
  });

  it('says none on record rather than zero open for a source that came back empty', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    // "0 open" would read the same for an empty source and a fully closed one.
    expect(summaryText(html, 'ISD violation cases')).toContain('none on record');
  });

  it('opens the living conditions row by default and leaves the others closed', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    expect(ledgerRow(html, '311 living conditions requests').hasAttribute('open')).toBe(true);
    for (const heading of [
      'ISD violation cases',
      '311 building and code requests',
      'Building permits',
      'Public Works code enforcement tickets',
      '311 property upkeep requests',
    ]) {
      expect(ledgerRow(html, heading).hasAttribute('open')).toBe(false);
    }
  });

  it('makes each summary a tappable row that carries its own count', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const summary = ledgerRow(await renderPanel(db), 'Building permits').querySelector('summary');

    // The one class worth pinning: the row is the tap target on a phone, and 44px is the floor.
    expect(summary?.className).toContain('min-h-[44px]');
    // Everything a closed row has to answer lives in the summary, not behind the disclosure.
    expect(summary?.querySelector('h4')?.textContent).toContain('Building permits');
    expect(summary?.textContent).toContain('pulled ');
    expect(summary?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('charts the requests by year and by what was reported', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const requests = ledgerRow(await renderPanel(db), '311 living conditions requests');

    expect(requests.textContent).toContain('Requests by year opened');
    expect(requests.textContent).toContain('What was reported');
    const chart = requests.querySelector('[role="img"]');
    expect(chart?.getAttribute('aria-label')).toContain('2 requests across 2024 to 2026');
    // Every year in the span draws, including 2025, which has nothing in it.
    expect(requests.innerHTML).toContain('title="2025: 0"');
    expect(requests.innerHTML).toContain('title="2026: 1"');
  });

  it('draws a year whose city 311 file is empty as missing, not as a zero, and says why', async () => {
    const db = await createDbWithAdmin();
    // One living-conditions request from 2013, so the chart's span crosses 2014.
    const heat = (legacy311 as AssessorRow[]).find((row) => String(row.type).startsWith('Heat'))!;
    await seedFullBuilding(db, [
      {
        resourceId: LEGACY_2013_RESOURCE_ID,
        records: [{ ...heat, case_enquiry_id: '101000000013', open_dt: '2013-02-01 09:00:00', closed_dt: '2013-02-03 09:00:00', case_status: 'Closed' }],
      },
    ]);

    const requests = ledgerRow(await renderPanel(db), '311 living conditions requests');

    const missing = requests.querySelector('[data-missing-year="2014"]');
    expect(missing?.getAttribute('title')).toBe('2014: no data');
    // Not a zero bar: no solid fill, and the note under the chart says why.
    expect(missing?.innerHTML).not.toMatch(/bg-gray-(200|700)/);
    expect(requests.innerHTML).not.toContain('title="2014: 0"');
    expect(requests.textContent).toContain('2014 is marked as missing data, not zero.');
    expect(requests.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('no data for 2014');
    // A year with no requests that the city does have a file for is still an ordinary zero.
    expect(requests.innerHTML).toContain('title="2015: 0"');
  });

  it('marks no year missing when the chart does not reach back to an empty file', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    expect(html).not.toContain('data-missing-year');
    expect(html).not.toContain('marked as missing data');
  });

  it('lists the requests still open in city records above the full list, and says what open means', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const requests = ledgerRow(await renderPanel(db), '311 living conditions requests');
    const heading = Array.from(requests.querySelectorAll('h5')).find((node) =>
      (node.textContent ?? '').trim().startsWith('Still open'),
    );

    expect(heading?.textContent?.trim()).toBe('Still open in city records (1)');
    // The explanation sits directly under the heading it explains.
    expect(heading?.nextElementSibling?.textContent?.trim()).toBe(STILL_OPEN_NOTE);
    expect(requests.textContent).not.toMatch(/open now/i);
    // Each open row says when it was filed: the year only, never a finer date than the row shows.
    const openList = heading?.nextElementSibling?.nextElementSibling;
    const openLabels = Array.from(openList?.querySelectorAll('li') ?? []).map((li) => li.lastElementChild?.textContent?.trim());
    expect(openLabels).toHaveLength(1);
    for (const label of openLabels) expect(label).toMatch(/^Still open in city records, filed \d{4}$/);
    expect(requests.textContent).toContain('Show all 2 requests');
    // The full list keeps the closed dates the summary rows leave out.
    expect(requests.textContent).toContain('closed Dec 20, 2024');
  });

  it('words open ISD violations the same way and keeps closed ones as recorded', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db, [OPEN_VIOLATION_ROUTE]);

    const violations = sectionText(await renderPanel(db), 'ISD violation cases');

    expect(violations).toContain(STILL_OPEN_NOTE);
    expect(violations).toContain('Still open in city records');
    // The feed carries a status date, not a filing date, so no "filed" year is claimed.
    expect(violations).not.toContain('filed');
    expect(violations).toContain('Closed');
    // Both rows are still listed.
    expect(violations).toContain('Example code line A');
    expect(violations).toContain('Example code line B');
  });

  it('leaves the explanation off a section with no open case', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    // The fixture's code enforcement tickets are all closed.
    expect(sectionText(html, 'Public Works code enforcement tickets')).not.toContain(STILL_OPEN_NOTE);
  });

  it("keeps an open permit's status as the city recorded it", async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const permits = ledgerRow(await renderPanel(db), 'Building permits');
    const statuses = Array.from(permits.querySelectorAll('li')).map((li) => li.lastElementChild?.textContent?.trim());

    // An open permit is an active permit, so it keeps the city's word.
    expect(statuses).toContain('Open');
    expect(permits.textContent).not.toContain('Still open in city records');
    expect(permits.textContent).not.toContain(STILL_OPEN_NOTE);
  });

  it('turns "Show all" into "Show less" once the list is open', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const permits = ledgerRow(await renderPanel(db), 'Building permits');
    const disclosure = permits.querySelector('details.records-show-all');
    const summary = disclosure?.querySelector('summary');

    // Both labels are in the summary; the panel's stylesheet shows the closed one until the
    // disclosure is open and the open one after, so the control never claims to show what is
    // already on screen.
    expect(summary?.querySelector('.records-show-all-closed')?.textContent?.trim()).toBe('Show all 2 permits');
    expect(summary?.querySelector('.records-show-all-open')?.textContent?.trim()).toBe(SHOW_LESS_LABEL);
    // A two-row list needs no second control at its end.
    expect(disclosure?.querySelector('button[data-records-show-less]')).toBeNull();
  });

  it('puts a second "Show less" after the last row of a long list, hidden until script can run it', async () => {
    const db = await createDbWithAdmin();
    const heat = (legacy311 as AssessorRow[]).find((row) => String(row.type).startsWith('Heat'))!;
    const manyRequests = Array.from({ length: 6 }, (_unused, index) => ({
      ...heat,
      case_enquiry_id: `10100000100${index}`,
      open_dt: `2023-0${index + 1}-01 09:00:00`,
      closed_dt: `2023-0${index + 1}-02 09:00:00`,
      case_status: 'Closed',
    }));
    await seedFullBuilding(db, [{ resourceId: LEGACY_2023_RESOURCE_ID, records: manyRequests }]);

    const requests = ledgerRow(await renderPanel(db), '311 living conditions requests');
    const disclosure = requests.querySelector('details.records-show-all');
    const endButton = disclosure?.querySelector('button[data-records-show-less]');

    expect(endButton?.textContent?.trim()).toBe(SHOW_LESS_LABEL);
    expect(endButton?.getAttribute('type')).toBe('button');
    // Script closes the list, so without script the button stays hidden rather than doing nothing.
    expect(endButton?.hasAttribute('hidden')).toBe(true);
    // It sits after the list, as the disclosure's last element.
    expect(disclosure?.lastElementChild).toBe(endButton);
  });

  it('pads the Source links and the Show all controls to a tappable height', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const fragment = parse(await renderPanel(db));
    const sources = Array.from(fragment.querySelectorAll('a')).filter((node) => (node.textContent ?? '').trim() === 'Source');
    const summaries = Array.from(fragment.querySelectorAll('details.records-show-all > summary'));

    // Bare text measured 40x15 (Source) and 20px tall (Show all); 24px is the floor.
    expect(sources.length).toBeGreaterThan(0);
    for (const link of sources) expect(link.className).toMatch(/\binline-block\b.*\bpy-1\.5\b|\bpy-1\.5\b.*\binline-block\b/);
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) expect(summary.className).toContain('py-1.5');
  });

  it('keeps a space between every count and its noun, and the noun in the right number', async () => {
    const db = await createDbWithAdmin();
    // Eight property upkeep types, so the category chart has a leftover line to print.
    const trash = (legacy311 as AssessorRow[]).find((row) => String(row.type).startsWith('Improper Storage'))!;
    const upkeepTypes = [
      'Improper Storage of Trash (Barrels)', 'Poor Conditions of Property', 'Unshoveled Sidewalk', 'Snow Removal',
      'Illegal Dumping', 'Construction Debris', 'Illegal Posting of Signs', 'Illegal Vending',
    ];
    const upkeepRows = upkeepTypes.map((type, index) => ({
      ...trash,
      case_enquiry_id: `10100000200${index}`,
      open_dt: `2023-0${index + 1}-01 09:00:00`,
      closed_dt: `2023-0${index + 1}-02 09:00:00`,
      case_status: 'Closed',
      type,
      case_title: type,
      reason: 'Code Enforcement',
    }));
    await seedFullBuilding(db, [OPEN_VIOLATION_ROUTE, { resourceId: LEGACY_2023_RESOURCE_ID, records: upkeepRows }]);

    const text = (parse(await renderPanel(db)).textContent ?? '').replace(/\s+/g, ' ');

    // "4requests", "2tickets", "42permits", "10more types" came from two expressions printed
    // side by side with the space between them lost.
    expect(text).not.toMatch(/\d(requests?|tickets?|permits?|cases?|more types?|code lines?|violation lines?)\b/);
    expect(text).toMatch(/\d+ more types? · \d+ requests?/);
    // "Show all 1 requests" was wrong in number; one record reads "Show 1 request".
    expect(text).not.toMatch(/\b1 (requests|tickets|permits|cases)\b/);
    expect(text).not.toContain('Show all 1 ');
    // The other-requests count is its own sentence, never "not shown" beside a Show all link.
    expect(text).not.toContain('not shown');
  });

  it('puts the 311 notes between the last group and the record-error fold, not an empty double rule', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const report = parse(await renderPanel(db)).querySelector('#report-record');
    const sources = report?.previousElementSibling;
    const notes = sources?.previousElementSibling;

    // The ledger's closing rule and the fold's opening rule used to sit 24px apart with
    // nothing between them. Now the grouping note sits there, then the source list.
    expect(sources?.id).toBe('records-sources');
    expect(sources?.className ?? '').not.toContain('border-b');
    expect(notes?.className ?? '').not.toContain('border-b');
    expect((notes?.textContent ?? '').trim()).toContain(GROUPING_NOTE);
  });

  it('keeps the full lists one disclosure down rather than dropping them', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    expect(sectionText(html, 'Building permits')).toContain('Show all 2 permits');
    expect(sectionText(html, 'Public Works code enforcement tickets')).toMatch(/Show all \d+ tickets/);
  });

  it('keeps the caveats inside their rows and says once how 311 requests are grouped', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);
    const text = parse(html).textContent ?? '';

    expect(sectionText(html, 'Building permits')).toContain(DECLARED_VALUATION_CAVEAT);
    // Said once for all three 311 rows, outside every disclosure, with the full list a link away.
    expect(text.split(GROUPING_NOTE)).toHaveLength(2);
    expect(sectionText(html, '311 living conditions requests')).not.toContain(GROUPING_NOTE);
    const link = Array.from(parse(html).querySelectorAll('a')).find(
      (node) => (node.textContent ?? '').trim() === GROUPING_LINK_TEXT,
    );
    expect(link?.getAttribute('href')).toBe('/methodology#public-records-are-not-scored');
    expect(text).not.toContain('not shown');
  });

  it('shows the three groups in the order the owner set, each with its rows', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const fragment = parse(await renderPanel(db));
    const groups = Array.from(fragment.querySelectorAll('section[aria-labelledby] > h3')).map((node) => (node.textContent ?? '').trim());
    expect(groups).toEqual(['Living conditions', 'Building safety and code', 'Property upkeep']);

    const rowsIn = (title: string) => {
      const heading = Array.from(fragment.querySelectorAll('section[aria-labelledby] > h3')).find(
        (node) => (node.textContent ?? '').trim() === title,
      );
      return Array.from(heading?.closest('section')?.querySelectorAll('summary h4') ?? []).map((node) =>
        (node.textContent ?? '').trim(),
      );
    };
    expect(rowsIn('Living conditions')).toEqual(['311 living conditions requests']);
    expect(rowsIn('Building safety and code')).toEqual([
      'ISD violation cases',
      '311 building and code requests',
      'Building permits',
    ]);
    expect(rowsIn('Property upkeep')).toEqual(['Public Works code enforcement tickets', '311 property upkeep requests']);
  });

  it('lists ISD lines under their case number and Public Works lines under their ticket', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db, [OPEN_VIOLATION_ROUTE]);

    const html = await renderPanel(db);

    const violations = sectionText(html, 'ISD violation cases');
    expect(violations).toContain('Case V100001');
    expect(violations).toContain('Case V100002');
    expect(summaryText(html, 'ISD violation cases')).toContain('1 open');
    const tickets = sectionText(html, 'Public Works code enforcement tickets');
    expect(tickets).toContain('Ticket T1');
    expect(tickets).toContain('Ticket T2');
    expect(tickets).toContain('Show all 2 tickets');
  });

  it('says an empty violations list is a fact about the feed, not a clearance', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const violations = sectionText(await renderPanel(db), 'ISD violation cases');

    expect(violations).toContain('No violations on record.');
    expect(violations).toContain(NO_VIOLATIONS_CAVEAT);
  });

  it('prints every status as plain text, never as something that looks like a button', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db, [OPEN_VIOLATION_ROUTE]);

    const html = await renderPanel(db);
    const statusSpans = Array.from(parse(html).querySelectorAll('li > span:last-child > span:first-child'));
    const statuses = statusSpans.map((node) => (node.textContent ?? '').trim());

    // The open and closed rows of every section are all here.
    expect(statuses).toEqual(expect.arrayContaining(['Open', 'Closed', 'Still open in city records']));
    expect(statuses.some((text) => /^Still open in city records, filed \d{4}$/.test(text))).toBe(true);
    for (const node of statusSpans) {
      // An outlined "Open" was read as a button that did nothing when tapped.
      expect(node.className).not.toMatch(/rounded|border|\bbg-|cursor-pointer|px-|py-|inline-flex/);
      // And no status carries a score band: the panel does not say an open record is bad news.
      expect(node.className).not.toMatch(/red|amber|orange|emerald|green|yellow/);
    }
    for (const heading of [
      '311 living conditions requests',
      '311 property upkeep requests',
      'Public Works code enforcement tickets',
      'ISD violation cases',
    ]) {
      expect(ledgerRow(html, heading).innerHTML).not.toMatch(/(bg|text|border)-(red|green|amber|emerald|yellow|orange)-\d/);
    }
  });

  it('shows a dash rather than a count for a source that has never been pulled', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);
    await db
      .prepare('DELETE FROM record_pulls WHERE building_id = ? AND source_id = ?')
      .bind(BUILDING_ID, VIOLATIONS_RESOURCE_ID)
      .run();

    const violations = ledgerRow(await renderPanel(db), 'ISD violation cases');

    // Nobody looked, so there is no count — not a zero, which would be a finding.
    expect(violations.querySelector('summary')?.textContent).toContain('—');
    expect(violations.querySelector('summary')?.textContent).toContain('not retrieved');
    expect(violations.textContent).toContain('Not retrieved yet');
    expect(violations.textContent).not.toContain('none on record');
  });

  it('keeps a correction note beside the count rather than behind the disclosure', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);
    await db
      .prepare(
        "INSERT INTO record_corrections (id, building_id, record_kind, claim, status, resolution, resolution_notes, resolved_at) " +
          "VALUES (?, ?, 'permit', 'The valuation is wrong', 'resolved', 'source_mismatch_noted', ?, 1770000000)",
      )
      .bind('corr-permit', BUILDING_ID, 'The city re-sent the same figure.')
      .run();

    const html = await renderPanel(db);
    const permits = ledgerRow(html, 'Building permits');

    // The permits row is closed, and a filed correction is context for the count on it.
    expect(permits.hasAttribute('open')).toBe(false);
    expect(html).toContain('The city re-sent the same figure.');
    expect(permits.textContent).not.toContain('The city re-sent the same figure.');
  });

  it('dates surviving rows to the pull that fetched them when a re-pull fails', async () => {
    const db = await createDbWithAdmin();
    // A full page of permits, so the row cap bites and the section says so.
    const capacityPermits = Array.from({ length: ROW_CAP }, (_unused, index) => ({
      ...(permitsPositive[0] as AssessorRow),
      permitnumber: 'CAP' + index,
    }));
    await seedPulledBuilding(db, lanark2026 as AssessorRow[], [
      { resourceId: PERMITS_RESOURCE_ID, records: capacityPermits },
    ]);

    // Re-pull: the permits feed is down, but the rows the earlier pull stored are still there.
    const building = await loadBuilding(db, BUILDING_ID);
    await pullBuildingRecords(db, building, {
      triggeredBy: ADMIN_ID,
      fetchImpl: fixtureFetch([
        { resourceId: FY2026_RESOURCE_ID, records: lanark2026 as AssessorRow[] },
        { resourceId: PERMITS_RESOURCE_ID, errorStatus: 503, errorMessage: UPSTREAM_ERROR_TEXT },
      ]),
    });

    const html = await renderPanel(db);
    const permits = ledgerRow(html, 'Building permits');

    expect(html).not.toContain(UPSTREAM_ERROR_TEXT);
    // Not "Record unavailable": there are rows. Not "as of today" either — that pull failed.
    expect(permits.querySelector('summary')?.textContent).toContain('last checked');
    expect(permits.textContent).not.toContain('Record unavailable');
    expect(permits.textContent).toContain('Showing records from an earlier retrieval.');
    expect(permits.querySelector('summary')?.textContent).toContain(String(ROW_CAP));

    // The dataset the stored rows came from is still cited.
    const source = Array.from(permits.querySelectorAll('a')).find(
      (node) => (node.textContent ?? '').trim() === 'Source',
    );
    expect(source?.getAttribute('href')).toContain('https://');

    // One cap note, on the list it describes.
    const capNotes = Array.from(permits.querySelectorAll('p')).filter((node) =>
      (node.textContent ?? '').includes('First ' + ROW_CAP + ' shown.'),
    );
    expect(capNotes).toHaveLength(1);
  });

  it('replaces the facts strip with the condominium note for a condo parcel', async () => {
    const db = await createDbWithAdmin();
    await insertBuilding(db, { id: 'bldg-condo', address: '55 Lanark Rd, Boston, MA 02135' });
    const building = await loadBuilding(db, 'bldg-condo');
    // No whole-building parcel, three condo rows behind the address: the same two-query
    // resolution the live assessor source runs, answered the way a condo answers it.
    await pullBuildingRecords(db, building, {
      triggeredBy: ADMIN_ID,
      fetchImpl: fixtureFetch([
        { resourceId: FY2026_RESOURCE_ID, sqlIncludes: 'NOT IN', records: [] },
        { resourceId: FY2026_RESOURCE_ID, sqlIncludes: 'count(*)', records: [{ n: condo2026.length }] },
      ]),
    });

    const html = await renderPanel(db, 'bldg-condo');

    expect(html).toContain(CONDOMINIUM_COPY);
    expect(html).not.toContain('Owner of record');
    expect(html).not.toContain('<polyline');
    // The ledger still renders: the condo rule is about the assessor row, not the whole panel.
    expect(sectionText(html, 'Building permits')).toContain('No permitted work on record since 2006');
  });
});

/**
 * The request button's page states (design spec Section 4). Each case is what a seeded
 * building looks like in production — a parcel and the assessor pull row the seed wrote, which
 * is what makes the panel render at all — so the only thing that varies is what the queue and
 * the deeper sources hold for it. There is no no-panel case to cover: the button lives inside
 * the panel, and a building with no pulls has neither.
 */
suite('BuildingRecords.astro request button states', () => {
  /** A seeded Boston building: eligible, panel-rendering, and nothing deeper pulled. */
  async function seededBuilding(id: string): Promise<TestD1Database> {
    const db = createRecordsTestDb();
    await insertBuilding(db, { id, parcel_id: '2102396000' });
    await insertPull(db, id, FY2026_RESOURCE_ID);
    return db;
  }

  /**
   * Rendered text rather than raw HTML, so the copy constants can be asserted whole: the
   * button label carries an apostrophe, which the markup escapes to a character reference.
   * Reading it back through the DOM decodes it again. The island is server-rendered by
   * `client:load`, so its label is in this text.
   */
  function panelText(html: string): string {
    return parse(html).textContent ?? '';
  }

  it('offers the button on a building nobody has asked about', async () => {
    const text = panelText(await renderPanel(await seededBuilding('bldg-state-1'), 'bldg-state-1'));

    expect(text).toContain(REQUEST_BUTTON_LABEL);
    expect(text).not.toContain(REQUESTED_COPY);

    // Where it sits, not just that it is somewhere: below the facts strip the seed did fill
    // and above the four rows it is offering to fill. A seeded building has a parcel and an
    // assessor pull but no assessment rows, so the strip is the empty-record line.
    const factsIndex = text.indexOf('No assessor record on file.');
    const labelIndex = text.indexOf(REQUEST_BUTTON_LABEL);
    const ledgerIndex = text.indexOf('311 living conditions requests');
    expect(factsIndex).toBeGreaterThan(-1);
    expect(labelIndex).toBeGreaterThan(factsIndex);
    expect(ledgerIndex).toBeGreaterThan(labelIndex);
  });

  it('tells a fill-queued building it is queued and still offers the button', async () => {
    const db = await seededBuilding('bldg-state-2');
    await enqueue(db, { buildingId: 'bldg-state-2', reason: 'fill', now: 1_000 });

    const text = panelText(await renderPanel(db, 'bldg-state-2'));

    // The city-wide pass will reach this building eventually; the button is the shortcut.
    expect(text).toContain(FILL_QUEUED_COPY);
    expect(text).toContain(REQUEST_BUTTON_LABEL);
  });

  it('replaces the button with the requested line once someone has pressed it', async () => {
    const db = await seededBuilding('bldg-state-3');
    await enqueue(db, { buildingId: 'bldg-state-3', reason: 'button', now: 1_000 });

    const text = panelText(await renderPanel(db, 'bldg-state-3'));

    expect(text).toContain(REQUESTED_COPY);
    expect(text).not.toContain(REQUEST_BUTTON_LABEL);
  });

  it('tells a reader the truth when the queue row has used all its attempts', async () => {
    const db = await seededBuilding('bldg-state-5');
    await enqueue(db, { buildingId: 'bldg-state-5', reason: 'button', now: 1_000 });
    await db
      .prepare('UPDATE records_queue SET attempts = ? WHERE building_id = ? AND done_at IS NULL')
      .bind(MAX_ATTEMPTS, 'bldg-state-5')
      .run();

    const text = panelText(await renderPanel(db, 'bldg-state-5'));

    // Not "reload to check": the row is not going to be claimed again on its own.
    expect(text).toContain(REQUEST_PARKED_COPY);
    expect(text).not.toContain(REQUESTED_COPY);
    expect(text).not.toContain(REQUEST_BUTTON_LABEL);
  });

  it('offers neither once the deeper records are in', async () => {
    const db = await seededBuilding('bldg-state-4');
    await insertPull(db, 'bldg-state-4', PERMITS_RESOURCE_ID);

    const html = await renderPanel(db, 'bldg-state-4');
    const text = panelText(html);

    // Anchored on the panel itself: three of these four assertions are absences, and an
    // unrendered panel would satisfy them all.
    expect(html).toContain('id="public-records"');
    // The ledger below is the answer now, and the button never comes back.
    expect(text).not.toContain(REQUEST_BUTTON_LABEL);
    expect(text).not.toContain(REQUESTED_COPY);
  });

  /** Moves every pull row for the building back by `days`. */
  async function agePulls(db: TestD1Database, id: string, days: number): Promise<void> {
    await db
      .prepare('UPDATE record_pulls SET retrieved_at = retrieved_at - ? WHERE building_id = ?')
      .bind(days * 86_400, id)
      .run();
  }

  it('notes an old pull beside its date once the deeper records are in, and offers newer records under it', async () => {
    const db = await seededBuilding('bldg-state-6');
    await insertPull(db, 'bldg-state-6', PERMITS_RESOURCE_ID);
    await agePulls(db, 'bldg-state-6', 45);

    const html = await renderPanel(db, 'bldg-state-6');
    const text = panelText(html);

    expect(text).toContain(STALE_PULL_NOTE);
    expect(text).toContain(REFRESH_BUTTON_LABEL);
    expect(text).not.toContain(REQUEST_BUTTON_LABEL);
    expect(text).not.toContain(REFRESH_REQUESTED_COPY);

    // Where it sits: in the panel header, right after the pull-date line that carries the
    // note, and before the facts strip and the ledger.
    const panel = parse(html);
    const line = panel.querySelector('#public-records h2')?.nextElementSibling;
    expect(line?.textContent ?? '').toContain(STALE_PULL_NOTE);
    const header = line?.parentElement;
    expect(header?.textContent ?? '').toContain(REFRESH_BUTTON_LABEL);
    expect(text.indexOf(REFRESH_BUTTON_LABEL)).toBeLessThan(text.indexOf('311 living conditions requests'));
    // No help line on the refresh button: the note above it already says why.
    expect(text).not.toContain(REQUEST_BUTTON_HELP);
  });

  it('says a new pull is queued, with no button, once a refresh row is pending', async () => {
    const db = await seededBuilding('bldg-state-9');
    await insertPull(db, 'bldg-state-9', PERMITS_RESOURCE_ID);
    await agePulls(db, 'bldg-state-9', 45);
    await enqueue(db, { buildingId: 'bldg-state-9', reason: 'button', now: Math.floor(Date.now() / 1000) });

    const html = await renderPanel(db, 'bldg-state-9');
    const text = panelText(html);

    expect(text).toContain(REFRESH_REQUESTED_COPY);
    // The records shown are still the old pull until the new one lands.
    expect(text).toContain(STALE_PULL_NOTE);
    expect(text).not.toContain(REFRESH_BUTTON_LABEL);
    expect(text).not.toContain(REQUEST_BUTTON_LABEL);
    // Not the never-pulled wording: these records are on the page.
    expect(text).not.toContain(REQUESTED_COPY);
    const header = parse(html).querySelector('#public-records h2')?.parentElement;
    expect(header?.textContent ?? '').toContain(REFRESH_REQUESTED_COPY);
  });

  it('offers no refresh on a pull 30 days old or less', async () => {
    const db = await seededBuilding('bldg-state-10');
    await insertPull(db, 'bldg-state-10', PERMITS_RESOURCE_ID);
    await agePulls(db, 'bldg-state-10', 29);

    const html = await renderPanel(db, 'bldg-state-10');
    const text = panelText(html);

    expect(html).toContain('id="public-records"');
    expect(text).not.toContain(REFRESH_BUTTON_LABEL);
    expect(text).not.toContain(STALE_PULL_NOTE);
    expect(text).not.toContain(REFRESH_REQUESTED_COPY);
  });

  it('leaves the stale note off a page that still offers the button', async () => {
    const db = await seededBuilding('bldg-state-7');
    await agePulls(db, 'bldg-state-7', 45);

    const text = panelText(await renderPanel(db, 'bldg-state-7'));

    // The button already says what this page can do about its records.
    expect(text).toContain(REQUEST_BUTTON_LABEL);
    expect(text).not.toContain(STALE_PULL_NOTE);
    expect(text).not.toContain(REFRESH_BUTTON_LABEL);
  });

  it('cites only the assessor year on a seeded building', async () => {
    const html = await renderPanel(await seededBuilding('bldg-state-8'), 'bldg-state-8');
    const sources = parse(html).querySelector('#records-sources');
    const hrefs = Array.from(sources?.querySelectorAll('a') ?? []).map((link) => link.getAttribute('href'));

    expect(hrefs).toContain(`https://data.boston.gov/dataset/property-assessment/resource/${FY2026_RESOURCE_ID}`);
    expect(hrefs.filter((href) => href?.includes('/resource/'))).toHaveLength(1);
    expect(sources?.textContent ?? '').not.toContain('311 Service Requests');
  });
});
