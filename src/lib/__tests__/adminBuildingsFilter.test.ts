import { describe, expect, it } from 'vitest';
import { adminBuildingsUrl, parseAdminBuildingsFilter } from '../admin/buildingsFilter';
import { applyBuildingPatch, buildingEditForm, buildingEditPatch } from '../admin/buildingEdit';
import type { AdminBuilding } from '../api-types';

describe('parseAdminBuildingsFilter', () => {
  it('reads landlord, a trimmed q capped at 200 chars, and the orphans filter', () => {
    const filter = parseAdminBuildingsFilter(new URLSearchParams({ landlord: ' ll-1 ', q: `  ${'x'.repeat(250)}`, filter: 'orphans' }));
    expect(filter.landlord).toBe('ll-1');
    expect(filter.q).toBe('x'.repeat(200));
    expect(filter.orphans).toBe(true);
  });

  it('treats blanks and unknown filters as inactive', () => {
    expect(parseAdminBuildingsFilter(new URLSearchParams({ landlord: '', q: '   ', filter: 'all' }))).toEqual({
      landlord: null,
      q: null,
      orphans: false,
    });
  });
});

describe('adminBuildingsUrl', () => {
  it('carries only the active filters', () => {
    expect(adminBuildingsUrl({ limit: 100, offset: 0 }, { landlord: null, q: null, orphans: false })).toBe(
      '/api/admin/buildings?limit=100&offset=0',
    );
    expect(adminBuildingsUrl({ limit: 100, offset: 200 }, { landlord: 'll 1', q: '12 Main & Co', orphans: true })).toBe(
      '/api/admin/buildings?limit=100&offset=200&landlord=ll+1&q=12+Main+%26+Co&filter=orphans',
    );
  });
});

const building: AdminBuilding = {
  id: 'b-1',
  address: '12 Lanark Rd',
  slug: '12-lanark-rd',
  neighborhood: null,
  city: 'Boston',
  state: 'MA',
  zip_code: '02135',
  latitude: null,
  longitude: null,
  year_built: 1910,
  unit_count: null,
  building_type: null,
  landlord_id: 'll-1',
  landlord_name: 'AA Management',
  property_manager_id: null,
  property_manager_name: null,
  created_at: 1,
  admin_notes: 'Owner disputes the unit count',
  owner_name: 'Lanark LLC',
  owner_entity: 'llc',
  owner_website: null,
  review_count: 0,
  avg_score: null,
};

describe('building edit round-trip', () => {
  it('starts the form from the stored notes and owner fields', () => {
    const form = buildingEditForm(building);
    expect(form.admin_notes).toBe('Owner disputes the unit count');
    expect(form.owner_name).toBe('Lanark LLC');
    expect(form.owner_website).toBe('');
    expect(form.unit_count).toBeNull();
  });

  it('an unchanged form patches nothing', () => {
    expect(buildingEditPatch(building, buildingEditForm(building))).toEqual({});
  });

  it('sends only the changed field, never the untouched notes', () => {
    const form = { ...buildingEditForm(building), year_built: 1912 };
    expect(buildingEditPatch(building, form)).toEqual({ year_built: 1912 });
  });

  it('a cleared field is sent so the server can null it', () => {
    const form = { ...buildingEditForm(building), admin_notes: '' };
    expect(buildingEditPatch(building, form)).toEqual({ admin_notes: '' });
  });

  it('applies a patch the way the server stores it, keeping untouched fields', () => {
    const updated = applyBuildingPatch(building, { admin_notes: '', year_built: 1912 });
    expect(updated.admin_notes).toBeNull();
    expect(updated.year_built).toBe(1912);
    expect(updated.owner_name).toBe('Lanark LLC');
    expect(building.admin_notes).toBe('Owner disputes the unit count');
  });

  it('ignores fields the form never held', () => {
    expect(buildingEditPatch(building, { owner_name: 'New LLC' })).toEqual({ owner_name: 'New LLC' });
  });
});
