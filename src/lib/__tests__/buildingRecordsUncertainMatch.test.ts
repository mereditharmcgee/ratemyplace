import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import reactRenderer from '@astrojs/react/server.js';
import { describe, expect, it } from 'vitest';
import BuildingRecords from '../../components/BuildingRecords.astro';
import { pullBuildingRecords } from '../records/pull';
import type { BuildingRowForIdentity } from '../records/identity';
import { FY2026_RESOURCE_ID } from '../records/sources/boston/assessor';
import { NO_VIOLATIONS_CAVEAT, UNCERTAIN_MATCH_SUBCOUNT, uncertainMatchCopy } from '../records/display';
import { sqliteAvailable, type TestD1Database } from './helpers/sqliteD1';
import { createRecordsTestDb, insertBuilding } from './helpers/recordsDb';
import { fixtureFetch } from './helpers/records/fixtureFetch';

/**
 * The records panel on a building whose address-keyed match is uncertain: every source answers
 * with nothing, and the panel must say the records could not be matched with confidence rather
 * than "none on record". Synthetic addresses and a synthetic assessor row throughout.
 */

const suite = sqliteAvailable ? describe : describe.skip;

const ADMIN_ID = 'admin-uncertain';
const BUILDING_ID = 'bldg-uncertain';

const ASSESSOR_ROW = {
  PID: '0100000001', OWNER: 'EXAMPLE HOLDINGS LLC', LU: 'A', LU_DESC: 'APARTMENT', YR_BUILT: '1910', YR_REMODEL: null,
  GROSS_AREA: '9000', LIVING_AREA: '8000', RES_UNITS: '9', COM_UNITS: null, TOTAL_VALUE: '2,000,000', LAND_VALUE: '500,000',
  BLDG_VALUE: '1,500,000', MAIL_ADDRESSEE: null, MAIL_STREET_ADDRESS: '1 EXAMPLE SQ', MAIL_CITY: 'BOSTON', MAIL_STATE: 'MA',
  MAIL_ZIP_CODE: '02135', ST_NUM: '10', ST_NUM2: '20', ZIP_CODE: '02135',
};

async function renderFor(address: string, assessorRow: Record<string, unknown> = ASSESSOR_ROW): Promise<HTMLElement> {
  const db: TestD1Database = createRecordsTestDb();
  await db.prepare('INSERT INTO users (id, email, is_admin) VALUES (?, ?, 1)').bind(ADMIN_ID, 'admin@example.com').run();
  await insertBuilding(db, { id: BUILDING_ID, address, zip_code: '02135', parcel_id: '0100000001' });
  const building = await db
    .prepare('SELECT id, address, city, state, zip_code, parcel_id, sam_id FROM buildings WHERE id = ?')
    .bind(BUILDING_ID)
    .first<BuildingRowForIdentity>();
  await pullBuildingRecords(db, building!, {
    triggeredBy: ADMIN_ID,
    fetchImpl: fixtureFetch([{ resourceId: FY2026_RESOURCE_ID, records: [assessorRow] }]),
  });

  const container = await AstroContainer.create();
  container.addServerRenderer({ renderer: reactRenderer });
  container.addClientRenderer({ name: '@astrojs/react', entrypoint: '@astrojs/react/client.js' });
  const html = await container.renderToString(BuildingRecords, {
    props: { buildingId: BUILDING_ID },
    request: new Request(`https://ratemyplace.org/building/${BUILDING_ID}`),
    locals: { user: null, session: null, runtime: { env: { DB: db } } } as unknown as App.Locals,
    partial: true,
  });
  const fragment = document.createElement('div');
  fragment.innerHTML = html;
  return fragment;
}

function rowText(fragment: HTMLElement, heading: string): string {
  const match = Array.from(fragment.querySelectorAll('summary h4')).find((node) =>
    (node.textContent ?? '').trim().startsWith(heading),
  );
  if (!match) throw new Error(`no "${heading}" ledger row`);
  return match.closest('details')?.textContent ?? '';
}

suite('BuildingRecords.astro under an uncertain match', () => {
  it('says the records could not be matched with confidence on a mixed-parity address', async () => {
    const panel = await renderFor('10-15 Example Rd');
    const violations = rowText(panel, 'ISD violation cases');
    expect(violations).toContain(UNCERTAIN_MATCH_SUBCOUNT);
    expect(violations).toContain(uncertainMatchCopy('mixed_parity'));
    expect(violations).not.toContain('none on record');
    expect(violations).not.toContain('No violations on record.');
    expect(violations).not.toContain(NO_VIOLATIONS_CAVEAT);
    const tickets = rowText(panel, 'Public Works code enforcement tickets');
    expect(tickets).toContain(uncertainMatchCopy('mixed_parity'));
    expect(tickets).not.toContain('No code enforcement tickets on record.');
    // Each 311 group prints its own empty state, so each one gives way to the match note.
    for (const [heading, emptyCopy] of [
      ['311 living conditions requests', 'No living conditions requests on record.'],
      ['311 building and code requests', 'No building and code requests on record.'],
      ['311 property upkeep requests', 'No property upkeep requests on record.'],
    ]) {
      const requests = rowText(panel, heading);
      expect(requests).toContain(UNCERTAIN_MATCH_SUBCOUNT);
      expect(requests).toContain(uncertainMatchCopy('mixed_parity'));
      expect(requests).not.toContain(emptyCopy);
    }
    // Permits are keyed on the parcel too, so their empty state is unchanged.
    expect(rowText(panel, 'Building permits')).toContain('none on record');
  });

  it('says so for a single address on a wider parcel, read from the stored current-year row', async () => {
    const violations = rowText(await renderFor('16 Example Rd'), 'ISD violation cases');
    expect(violations).toContain(uncertainMatchCopy('parcel_wider'));
  });

  it('keeps "none on record" when the address covers the whole parcel', async () => {
    const violations = rowText(await renderFor('10-20 Example Rd'), 'ISD violation cases');
    expect(violations).toContain('none on record');
    expect(violations).toContain('No violations on record.');
    expect(violations).not.toContain(UNCERTAIN_MATCH_SUBCOUNT);
  });
});
