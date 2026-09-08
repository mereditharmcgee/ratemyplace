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
  NO_VIOLATIONS_CAVEAT,
  OTHER_REQUESTS_COPY,
} from '../records/display';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
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

/**
 * The panel's privacy and empty-state rules, checked against the HTML the server actually
 * emits rather than against the helpers underneath it. `display.ts` deciding to withhold a
 * mailing address is worth nothing if the template renders the field anyway, and only a
 * render can tell the two apart.
 *
 * The whole component renders here, island and all: `BuildingRecords.astro` mounts
 * `RecordCorrectionForm` with `client:load`, so the container needs the React renderer
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
 * right one. Each row is a `<details>` whose `<summary>` carries the `h3`.
 */
function ledgerRow(html: string, heading: string): HTMLDetailsElement {
  const fragment = parse(html);
  const headings = Array.from(fragment.querySelectorAll('summary h3'));
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
    const violations = sectionText(html, 'ISD violations');

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
  async function seedFullBuilding(db: TestD1Database): Promise<void> {
    await seedPulledBuilding(db, lanark2026 as AssessorRow[], [
      { resourceId: FY2025_RESOURCE_ID, records: lanark2025 as AssessorRow[] },
      { resourceId: PERMITS_RESOURCE_ID, records: permitsPositive as AssessorRow[] },
      { resourceId: LEGACY_2024_RESOURCE_ID, records: legacy311 as AssessorRow[] },
      { resourceId: NEW_311_RESOURCE_ID, records: new311 as AssessorRow[] },
      { resourceId: ENFORCEMENT_RESOURCE_ID, records: enforcementRows as AssessorRow[] },
    ]);
  }

  function summaryText(html: string, heading: string): string {
    return ledgerRow(html, heading).querySelector('summary')?.textContent ?? '';
  }

  it('heads the panel with the jurisdiction and the pull date', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    expect(html).toContain('City of Boston · pulled');
    // The correction link is the panel's one call to action and has to be tappable.
    expect(html).toMatch(/href="#report-record"[^>]*min-h-\[44px\]/);
  });

  it('renders the assessor facts strip rather than a definition list', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    expect(html).toContain('Owner of record');
    expect(html).toContain('LANARK ROAD LLC MASS LLC');
    expect(html).toContain('Assessor FY2026 · parcel 2102098000');
    expect(html).toContain('Built');
    expect(html).toContain('1920');
    expect(html).toContain('Last remodel 1980 · units not recorded');
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

    // Three housing-classified requests, two of them still open; the rest are counted and named.
    const requests = summaryText(html, '311 housing requests');
    expect(requests).toContain('2 open');
    expect(requests).toContain('5 other requests not shown');
    expect(requests).toContain('2024–2026');

    // Two permits after the duplicate row is deduped, one open, $36,500 + $1,200 declared.
    const permits = summaryText(html, 'Building permits');
    expect(permits).toContain('1 open · $37.7K declared');
    expect(permits).toContain('2019–2021');
  });

  it('says none on record rather than zero open for a source that came back empty', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    // "0 open" would read the same for an empty source and a fully closed one.
    expect(summaryText(html, 'ISD violations')).toContain('none on record');
  });

  it('opens the 311 row by default and leaves the other three closed', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    expect(ledgerRow(html, '311 housing requests').hasAttribute('open')).toBe(true);
    for (const heading of ['Building permits', 'Code enforcement tickets', 'ISD violations']) {
      expect(ledgerRow(html, heading).hasAttribute('open')).toBe(false);
    }
  });

  it('makes each summary a focusable row with the default marker hidden', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);
    const summary = ledgerRow(html, 'Building permits').querySelector('summary');

    expect(summary?.className).toContain('min-h-[44px]');
    expect(summary?.className).toContain('list-none');
    expect(summary?.className).toContain('[&::-webkit-details-marker]:hidden');
    expect(summary?.className).toContain('focus-visible:outline-teal-700');
  });

  it('charts the requests by year and by what was reported', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const requests = ledgerRow(await renderPanel(db), '311 housing requests');

    expect(requests.textContent).toContain('Requests by year opened');
    expect(requests.textContent).toContain('What was reported');
    const chart = requests.querySelector('[role="img"]');
    expect(chart?.getAttribute('aria-label')).toContain('3 requests across 2024 to 2026');
    // Every year in the span draws, including 2025, which has nothing in it.
    expect(requests.innerHTML).toContain('title="2025: 0"');
    expect(requests.innerHTML).toContain('title="2026: 1"');
  });

  it('lists what is open now above the full list', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const requests = ledgerRow(await renderPanel(db), '311 housing requests');

    expect(requests.textContent).toContain('Open now (2)');
    expect(requests.textContent).toContain('Show all 3 requests');
    // The full list keeps the closed dates the summary rows leave out.
    expect(requests.textContent).toContain('closed Dec 20, 2024');
  });

  it('keeps the full lists one disclosure down rather than dropping them', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    expect(sectionText(html, 'Building permits')).toContain('Show all 2 permits');
    expect(sectionText(html, 'Code enforcement tickets')).toMatch(/Show all \d+ tickets/);
  });

  it('keeps the caveats and the classification note inside their rows', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const html = await renderPanel(db);

    expect(sectionText(html, 'Building permits')).toContain(DECLARED_VALUATION_CAVEAT);
    const requests = sectionText(html, '311 housing requests');
    expect(requests).toContain('How requests are classified');
    expect(requests).toContain(OTHER_REQUESTS_COPY);
  });

  it('says an empty violations list is a fact about the feed, not a clearance', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const violations = sectionText(await renderPanel(db), 'ISD violations');

    expect(violations).toContain('No violations on record.');
    expect(violations).toContain(NO_VIOLATIONS_CAVEAT);
  });

  it('marks an open record with an outlined token and never a score colour', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);

    const requests = ledgerRow(await renderPanel(db), '311 housing requests');
    const open = Array.from(requests.querySelectorAll('span')).find(
      (node) => (node.textContent ?? '').trim() === 'Open' && node.className.includes('rounded-full'),
    );

    expect(open).toBeTruthy();
    expect(open?.className).toContain('border-gray-400');
    // Grey, not a band colour: an outline says "find this in the list", not "this is bad news".
    expect(requests.innerHTML).not.toMatch(/(bg|text|border)-(red|green|amber|emerald|yellow|orange)-\d/);
  });

  it('shows a dash rather than a count for a source that has never been pulled', async () => {
    const db = await createDbWithAdmin();
    await seedFullBuilding(db);
    await db
      .prepare('DELETE FROM record_pulls WHERE building_id = ? AND source_id = ?')
      .bind(BUILDING_ID, VIOLATIONS_RESOURCE_ID)
      .run();

    const violations = ledgerRow(await renderPanel(db), 'ISD violations');

    // Nobody looked, so there is no count — not a zero, which would be a finding.
    expect(violations.querySelector('summary')?.textContent).toContain('—');
    expect(violations.querySelector('summary')?.textContent).toContain('not retrieved');
    expect(violations.textContent).toContain('Not retrieved yet');
    expect(violations.textContent).not.toContain('none on record');
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
    expect(ledgerRow(html, 'Building permits')).toBeTruthy();
  });
});
