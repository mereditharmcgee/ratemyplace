import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import BuildingRecords from '../../components/BuildingRecords.astro';
import { pullBuildingRecords } from '../records/pull';
import type { BuildingRowForIdentity } from '../records/identity';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { PERMITS_RESOURCE_ID } from '../records/sources/boston/permits';
import { VIOLATIONS_RESOURCE_ID } from '../records/sources/boston/violations';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { fixtureFetch, type FixtureRoute } from './helpers/records/fixtureFetch';
import lanark2026 from './helpers/records/assessor-fy2026-lanark.json';

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

/**
 * The section under a given heading, so an empty state can be attributed to the right
 * source. Each section is a `div.mt-6` wrapping a `RecordSectionHeader` (which supplies the
 * `h3`) and the body below it; the heading's own flex row is the inner div, hence `.mt-6`.
 */
function sectionText(html: string, heading: string): string {
  const fragment = document.createElement('div');
  fragment.innerHTML = html;
  const headings = Array.from(fragment.querySelectorAll('h3'));
  const match = headings.find((node) => (node.textContent ?? '').trim().startsWith(heading));
  if (!match) throw new Error(`Rendered panel has no "${heading}" section`);
  const section = match.closest('.mt-6');
  if (!section) throw new Error(`"${heading}" heading is not inside a panel section`);
  return section.textContent ?? '';
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
    const violations = sectionText(html, 'Violations');

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
