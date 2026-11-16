import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildIdentity } from '../records/identity';
import { jurisdictionForCity, sourcesForCity } from '../records/jurisdictions';
import { jurisdictionForCity as leafJurisdictionForCity, normalizeCity } from '../records/jurisdiction';
import { rentsmartSource, RENTSMART_RESOURCE_ID } from '../records/sources/boston/rentsmart';
import type { RentSmartPayload } from '../records/types';
import { fixtureFetch } from './helpers/records/fixtureFetch';
// The columns follow a recorded RentSmart response; every value is fictional.
import tarnwickRows from './helpers/records/rentsmart-tarnwick.json';

const tarnwick = buildIdentity({
  id: 'b1', address: '52-68 Tarnwick Pl, Boston, MA', city: 'Boston', state: 'MA', zip_code: '02135',
  parcel_id: '2109417000', sam_id: null,
});

describe('rentsmartSource', () => {
  it('queries by parcel (single literal when parcelId and numeric match) and returns all rows', async () => {
    const fetchImpl = fixtureFetch([{ resourceId: RENTSMART_RESOURCE_ID, records: tarnwickRows }]);
    const result = await rentsmartSource.run(tarnwick, fetchImpl);
    expect(result.query).toContain(`"parcel" IN ('2109417000')`);
    expect(result.query).toContain('ORDER BY "date" DESC, "_id" LIMIT 500');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].sourceKey).toBe('90001');
    const first = result.rows[0].payload as RentSmartPayload;
    expect(first).toMatchObject({
      rowId: '90001',
      violationType: 'Housing Complaints',
      description: 'Chronic Dampness/Mold',
      parcel: '2109417000',
    });
    expect(result.rows[0].kind).toBe('rentsmart');
  });

  it('queries both parcel forms when the id has a leading zero', async () => {
    const leadingZero = { ...tarnwick, parcelId: '0100001000', parcelNumeric: '100001000' };
    const fetchImpl = fixtureFetch([{ resourceId: RENTSMART_RESOURCE_ID, records: [] }]);
    const result = await rentsmartSource.run(leadingZero, fetchImpl);
    expect(result.query).toContain(`"parcel" IN ('0100001000','100001000')`);
  });

  it('skips the fetch entirely when the building has no parcel', async () => {
    const noParcel = { ...tarnwick, parcelId: null, parcelNumeric: null };
    const fetchImpl = fixtureFetch([{ resourceId: RENTSMART_RESOURCE_ID, records: tarnwickRows }]);
    const result = await rentsmartSource.run(noParcel, fetchImpl);
    expect(result.rows).toEqual([]);
    expect(result.query).toBe('no parcel: RentSmart skipped');
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('names the condominium skip distinctly from a plain missing parcel', async () => {
    const condo = { ...tarnwick, parcelId: null, parcelNumeric: null, condominium: true };
    const fetchImpl = fixtureFetch([{ resourceId: RENTSMART_RESOURCE_ID, records: tarnwickRows }]);
    const result = await rentsmartSource.run(condo, fetchImpl);
    expect(result.rows).toEqual([]);
    expect(result.query).toBe('condominium: no whole-building parcel, RentSmart skipped');
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('dedupes a repeated _id, keeping the first row seen', async () => {
    const withDuplicate = [...tarnwickRows, { ...tarnwickRows[0], description: 'Duplicate reload of the same row' }];
    const fetchImpl = fixtureFetch([{ resourceId: RENTSMART_RESOURCE_ID, records: withDuplicate }]);
    const result = await rentsmartSource.run(tarnwick, fetchImpl);
    expect(result.rows).toHaveLength(2);
    const first = result.rows[0].payload as RentSmartPayload;
    expect(first.rowId).toBe('90001');
    expect(first.description).toBe('Chronic Dampness/Mold');
  });

  it('drops a row with a null _id', async () => {
    const withNullId = [...tarnwickRows, { ...tarnwickRows[0], _id: null, description: 'No row number' }];
    const fetchImpl = fixtureFetch([{ resourceId: RENTSMART_RESOURCE_ID, records: withNullId }]);
    const result = await rentsmartSource.run(tarnwick, fetchImpl);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.some((r) => (r.payload as RentSmartPayload).description === 'No row number')).toBe(false);
  });
});

describe('jurisdictionForCity', () => {
  it('recognizes Boston regardless of case or trailing state', () => {
    expect(jurisdictionForCity('Boston, MA')).toBe('boston');
    expect(jurisdictionForCity('boston')).toBe('boston');
    expect(jurisdictionForCity('BOSTON')).toBe('boston');
    expect(jurisdictionForCity('Boston, MA ')).toBe('boston');
  });

  it('returns null for everything else', () => {
    expect(jurisdictionForCity('New Haven, CT')).toBeNull();
    expect(jurisdictionForCity(null)).toBeNull();
    expect(jurisdictionForCity('Cambridge')).toBeNull();
  });
});

describe('sourcesForCity', () => {
  it('returns all eleven Boston sources with expected labels and ownership', () => {
    const sources = sourcesForCity('Boston, MA');
    expect(sources).toHaveLength(11);
    const assessmentOwners = sources.filter((s) => s.kinds.includes('assessment'));
    expect(assessmentOwners).toHaveLength(6);
    const labels = sources.map((s) => s.label);
    expect(labels).toEqual([
      'Property Assessment FY2026',
      'Property Assessment FY2025',
      'Property Assessment FY2024',
      'Property Assessment FY2023',
      'Property Assessment FY2022',
      'Property Assessment FY2021',
      'Approved Building Permits',
      'Building and Property Violations',
      'Public Works Code Enforcement',
      '311 Service Requests',
      'RentSmart',
    ]);
  });

  it('has unique source ids across the Boston list', () => {
    const sources = sourcesForCity('Boston, MA');
    const ids = sources.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns an empty list for New Haven and unrecognized cities', () => {
    expect(sourcesForCity('New Haven, CT')).toEqual([]);
    expect(sourcesForCity(null)).toEqual([]);
    expect(sourcesForCity('Cambridge')).toEqual([]);
  });
});

// `records/jurisdiction.ts` (singular) exists so a client island can ask "is this a Boston
// building?" without the six CKAN adapters riding along. That only holds while the file
// stays a leaf, so the guard is a source scan, not a behaviour assertion.
describe('records/jurisdiction.ts is a leaf module', () => {
  const leaf = readFileSync(join(process.cwd(), 'src/lib/records/jurisdiction.ts'), 'utf8');

  it('imports nothing at all', () => {
    expect(leaf).not.toMatch(/^\s*import\s/m);
    expect(leaf).not.toContain('./sources/');
  });

  it('is the same city test the plural module re-exports', () => {
    expect(jurisdictionForCity).toBe(leafJurisdictionForCity);
    expect(normalizeCity('Boston, MA ')).toBe('boston');
  });
});

describe('RecordsPullButton', () => {
  const button = readFileSync(join(process.cwd(), 'src/components/admin/RecordsPullButton.tsx'), 'utf8');

  it('asks the leaf module instead of restating the city regex', () => {
    expect(button).toContain("from '../../lib/records/jurisdiction'");
    expect(button).not.toContain('[A-Z]{2}');
    expect(button).not.toMatch(/function isBoston/);
  });
});
