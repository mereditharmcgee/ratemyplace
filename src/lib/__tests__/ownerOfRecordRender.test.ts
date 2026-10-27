import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import BuildingRecords from '../../components/BuildingRecords.astro';
import OwnerList from '../../components/records/OwnerList.astro';
import OwnerOfRecordPage from '../../pages/owner-of-record.astro';
import SearchPage from '../../pages/search.astro';
import { pullBuildingRecords } from '../records/pull';
import type { BuildingRowForIdentity } from '../records/identity';
import { ownerRowFromAssessment } from '../records/ownerOfRecord';
import { loadOwnerList } from '../records/ownerList';
import { OWNER_LIST_INTRO, OWNER_LIST_NOT_PULLED_COPY, OWNER_OF_RECORD_LABEL, OWNER_SEARCH_NOTE } from '../records/display';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import type { AssessmentPayload } from '../records/types';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { fixtureFetch } from './helpers/records/fixtureFetch';

const suite = sqliteAvailable ? describe : describe.skip;

const ADMIN_ID = 'admin-owner-render';

async function createDb(): Promise<TestD1Database> {
  const db = createRecordsTestDb();
  await db.prepare('INSERT INTO users (id, email, is_admin) VALUES (?, ?, 1)').bind(ADMIN_ID, 'admin@example.com').run();
  return db;
}

function locals(db: TestD1Database): App.Locals {
  return { user: null, session: null, runtime: { env: { DB: db } } } as unknown as App.Locals;
}

async function container() {
  const c = await AstroContainer.create();
  c.addServerRenderer({ renderer: reactRenderer });
  c.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  return c;
}

/** A pulled building whose FY2026 assessor row names `owner`. */
async function pulledBuilding(db: TestD1Database, id: string, address: string, parcel: string, owner: string): Promise<void> {
  await insertBuilding(db, { id, address: `${address}, Boston, MA 02134`, zip_code: '02134', parcel_id: parcel });
  const building = await db
    .prepare('SELECT id, address, city, state, zip_code, parcel_id, sam_id FROM buildings WHERE id = ?')
    .bind(id)
    .first<BuildingRowForIdentity>();
  await pullBuildingRecords(db, building!, {
    triggeredBy: ADMIN_ID,
    fetchImpl: fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: [{ PID: parcel, OWNER: owner, LU: 'R3', LU_DESC: 'THREE-FAM DWELLING' }] }]),
  });
}

/** A building and its owner row only, as the backfill leaves an unpulled seeded building. */
async function ownedBuilding(db: TestD1Database, id: string, address: string, parcel: string, owner: string): Promise<void> {
  await insertBuilding(db, { id, address, parcel_id: parcel, zip_code: '02134', neighborhood: 'Allston' });
  const assessment: AssessmentPayload = {
    fiscalYear: 'FY2026', parcelId: parcel, owner, mailAddressee: null, mailStreet: null, mailCity: null, mailState: null, mailZip: null,
    landUse: 'R3', landUseDescription: 'THREE-FAM DWELLING', yearBuilt: null, yearRemodel: null, grossArea: null, livingArea: null,
    residentialUnits: null, commercialUnits: null, totalValue: null, landValue: null, buildingValue: null, condominium: false,
  };
  const row = ownerRowFromAssessment(id, assessment)!;
  await db
    .prepare('INSERT INTO building_owners (building_id, fiscal_year, parcel_id, owner, owner_key, is_entity, residential) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(row.buildingId, row.fiscalYear, row.parcelId, row.owner, row.ownerKey, row.isEntity, row.residential)
    .run();
}

function parse(html: string): HTMLElement {
  const fragment = document.createElement('div');
  fragment.innerHTML = html;
  return fragment;
}

/** The facts strip's owner cell. */
function ownerCell(html: string): HTMLElement {
  const term = Array.from(parse(html).querySelectorAll('dt')).find((dt) => dt.textContent?.trim() === 'Owner of record');
  const cell = term?.nextElementSibling as HTMLElement | null;
  if (!cell) throw new Error('no owner of record cell');
  return cell;
}

suite('the owner of record on the records panel, rendered', () => {
  async function renderPanel(db: TestD1Database, buildingId: string): Promise<string> {
    return (await container()).renderToString(BuildingRecords, {
      props: { buildingId },
      request: new Request(`https://ratemyplace.org/building/${buildingId}`),
      locals: locals(db),
      partial: true,
    });
  }

  it('links an entity owner to its list', async () => {
    const db = await createDb();
    await pulledBuilding(db, 'b-1', '12 Example Rd', '0100000001', 'EXAMPLE HOLDINGS LLC');
    const link = ownerCell(await renderPanel(db, 'b-1')).querySelector('a');
    expect(link?.textContent).toBe('EXAMPLE HOLDINGS LLC');
    expect(link?.getAttribute('href')).toBe('/owner-of-record?name=EXAMPLE+HOLDINGS+LLC');
  });

  it('keeps a person with one property as plain text, and links one with two', async () => {
    const db = await createDb();
    await pulledBuilding(db, 'b-1', '12 Example Rd', '0100000001', 'DOE JANE');
    let cell = ownerCell(await renderPanel(db, 'b-1'));
    expect(cell.querySelector('a')).toBeNull();
    expect(cell.textContent).toContain('DOE JANE');

    await pulledBuilding(db, 'b-2', '14 Example Rd', '0100000002', 'DOE JANE');
    cell = ownerCell(await renderPanel(db, 'b-1'));
    expect(cell.querySelector('a')?.getAttribute('href')).toBe('/owner-of-record?name=DOE+JANE');
  });

  it('keeps a family trust with one property as plain text, and links a realty trust', async () => {
    const db = await createDb();
    await pulledBuilding(db, 'b-home', '12 Example Rd', '0100000001', 'DOE FAMILY TRUST');
    await pulledBuilding(db, 'b-realty', '16 Example Rd', '0100000002', 'EXAMPLE REALTY TRUST');
    const cell = ownerCell(await renderPanel(db, 'b-home'));
    expect(cell.querySelector('a')).toBeNull();
    expect(cell.textContent).toContain('DOE FAMILY TRUST');
    const link = ownerCell(await renderPanel(db, 'b-realty')).querySelector('a');
    expect(link?.getAttribute('href')).toBe('/owner-of-record?name=EXAMPLE+REALTY+TRUST');
  });

  it('renders the panel with the owner as plain text before migration 0034 has run', async () => {
    const db = await createDb();
    await pulledBuilding(db, 'b-1', '12 Example Rd', '0100000001', 'EXAMPLE HOLDINGS LLC');
    db.exec('DROP TABLE building_owners');
    const html = await renderPanel(db, 'b-1');
    expect(html).toContain('id="public-records"');
    const cell = ownerCell(html);
    expect(cell.querySelector('a')).toBeNull();
    expect(cell.textContent).toContain('EXAMPLE HOLDINGS LLC');
  });
});

suite('the owner of record list, rendered', () => {
  it('labels the list, links each building, shows its counts and no score', async () => {
    const db = await createDb();
    await ownedBuilding(db, 'b-2', '2 Example Rd', '0100000002', 'EXAMPLE HOLDINGS LLC');
    await pulledBuilding(db, 'b-10', '10 Example Rd', '0100000010', 'Example Holdings, L.L.C.');
    const result = await loadOwnerList(db, 'EXAMPLE HOLDINGS LLC', 1, new Date('2026-10-27T12:00:00Z'));
    if (!result.found) throw new Error('expected a list');

    const html = await (await container()).renderToString(OwnerList, {
      props: { ownerKey: result.key, owner: result.owner, total: result.total, page: result.page, pageCount: result.pageCount, buildings: result.buildings },
      partial: true,
    });
    const root = parse(html);
    expect(root.textContent).toContain(OWNER_OF_RECORD_LABEL);
    expect(root.querySelector('h1')?.textContent).toBe('EXAMPLE HOLDINGS LLC');
    expect(root.textContent).toContain('2 buildings on RateMyPlace');
    expect(root.textContent).toContain(OWNER_LIST_INTRO);
    const rows = Array.from(root.querySelectorAll('[data-owner-list-row]'));
    expect(rows.map((row) => row.querySelector('a')?.getAttribute('href'))).toEqual(['/building/b-2', '/building/b-10']);
    // The unpulled building says so; the pulled one shows its counts in the three groups.
    expect(rows[0].textContent).toContain(OWNER_LIST_NOT_PULLED_COPY);
    expect(rows[1].textContent).toContain('Living conditions');
    expect(rows[1].textContent).toContain('Building safety and code');
    expect(rows[1].textContent).toContain('Property upkeep');
    expect(rows[1].textContent).toContain('Recorded as Example Holdings, L.L.C.');
    expect(rows[1].textContent).toContain('Assessor FY2026');
    // Counts only: no score, no rating, no review count on any row.
    for (const row of rows) {
      expect(row.textContent).not.toMatch(/score|rating|review|\d\.\d/i);
    }
    expect(root.querySelector('nav')).toBeNull();
  });

  it('links the next and previous pages of a long list', async () => {
    const render = async (page: number) =>
      parse(
        await (await container()).renderToString(OwnerList, {
          props: { ownerKey: 'EXAMPLE HOLDINGS LLC', owner: 'EXAMPLE HOLDINGS LLC', total: 45, page, pageCount: 3, buildings: [] },
          partial: true,
        }),
      );
    const middle = await render(2);
    expect(middle.querySelector('nav')?.textContent).toContain('Page 2 of 3');
    expect(middle.querySelector('a[rel="prev"]')?.getAttribute('href')).toBe('/owner-of-record?name=EXAMPLE+HOLDINGS+LLC');
    expect(middle.querySelector('a[rel="next"]')?.getAttribute('href')).toBe('/owner-of-record?name=EXAMPLE+HOLDINGS+LLC&page=3');
    const last = await render(3);
    expect(last.querySelector('a[rel="next"]')).toBeNull();
  });

  it('renders the page noindexed for an allowed name', async () => {
    const db = await createDb();
    await ownedBuilding(db, 'b-1', '1 Example Rd', '0100000001', 'EXAMPLE HOLDINGS LLC');
    const html = await (await container()).renderToString(OwnerOfRecordPage, {
      request: new Request('https://ratemyplace.org/owner-of-record?name=EXAMPLE+HOLDINGS+LLC'),
      locals: locals(db),
      partial: false,
    });
    expect(html).toMatch(/<meta name="robots" content="noindex, follow"/);
    expect(html).not.toMatch(/rel="canonical"/);
    expect(html).toContain('EXAMPLE HOLDINGS LLC');
  });

  // The container has no /404 route to rewrite to, so a rewrite surfaces as this error: the
  // page asked for the site's ordinary 404, the same answer for each of these names.
  it.each([
    ['a person who owns one property here', 'DOE JANE', true],
    ['a family trust that owns one property here', 'DOE FAMILY TRUST', true],
    ['a name with no buildings', 'NOBODY HOLDINGS LLC', true],
    ['any name before migration 0034 has run', 'EXAMPLE HOLDINGS LLC', false],
  ])('answers 404 for %s', async (_label, name, withTable) => {
    const db = await createDb();
    await ownedBuilding(db, 'b-1', '1 Example Rd', '0100000001', 'DOE JANE');
    await ownedBuilding(db, 'b-2', '2 Example Rd', '0100000002', 'EXAMPLE HOLDINGS LLC');
    await ownedBuilding(db, 'b-3', '3 Example Rd', '0100000003', 'DOE FAMILY TRUST');
    if (!withTable) db.exec('DROP TABLE building_owners');
    await expect(
      (await container()).renderToResponse(OwnerOfRecordPage, {
        request: new Request(`https://ratemyplace.org/owner-of-record?name=${encodeURIComponent(name)}`),
        locals: locals(db),
      }),
    ).rejects.toThrow(/route \/404/);
  });
});

suite('owner names on the search page, rendered', () => {
  async function renderSearch(db: TestD1Database, query: string, type: string): Promise<string> {
    return (await container()).renderToString(SearchPage, {
      request: new Request(`https://ratemyplace.org/search?q=${encodeURIComponent(query)}&type=${type}`),
      locals: locals(db),
      partial: false,
    });
  }

  function main(html: string): HTMLElement {
    const match = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
    if (!match) throw new Error('Rendered page is missing <main>');
    return parse(match[1]);
  }

  it('lists a matching owner of record under the Landlords filter, linked to its list', async () => {
    const db = await createDb();
    await ownedBuilding(db, 'b-1', '1 Example Rd', '0100000001', 'EXAMPLE HOLDINGS LLC');
    await ownedBuilding(db, 'b-2', '2 Example Rd', '0100000002', 'EXAMPLE HOLDINGS LLC');
    const root = main(await renderSearch(db, 'example holdings', 'landlords'));
    expect(root.textContent).toContain(`${OWNER_OF_RECORD_LABEL} (1)`);
    expect(root.textContent).toContain(OWNER_SEARCH_NOTE);
    expect(root.textContent).toContain('2 buildings on RateMyPlace');
    expect(root.textContent).not.toContain('No landlords match that search');
    const link = Array.from(root.querySelectorAll('a')).find((a) => a.getAttribute('href')?.startsWith('/owner-of-record'));
    expect(link?.getAttribute('href')).toBe('/owner-of-record?name=EXAMPLE+HOLDINGS+LLC');
  });

  it.each([
    ['a person', 'DOE JANE', 'Doe Jane'],
    ['a family trust', 'DOE FAMILY TRUST', 'Doe Family'],
    ['a nominee trust', '1 EXAMPLE RD NOMINEE TRUST', 'nominee trust'],
  ])('shows the landlord empty state for %s that owns one property here', async (_label, owner, query) => {
    const db = await createDb();
    await ownedBuilding(db, 'b-1', '1 Example Rd', '0100000001', owner);
    const root = main(await renderSearch(db, query, 'landlords'));
    expect(root.textContent).toContain('No landlords match that search');
    expect(root.textContent).not.toContain(OWNER_OF_RECORD_LABEL);
    expect(root.innerHTML).not.toContain('/owner-of-record');
  });
});
