import type { AdminBuilding } from '../api-types';

/** The fields the admin building edit form holds and `PATCH /api/admin/buildings/[id]` accepts. */
export const BUILDING_EDIT_FIELDS = [
  'address',
  'neighborhood',
  'city',
  'state',
  'zip_code',
  'year_built',
  'unit_count',
  'building_type',
  'landlord_id',
  'property_manager_id',
  'admin_notes',
  'owner_name',
  'owner_entity',
  'owner_website',
] as const;

export type BuildingEditField = (typeof BUILDING_EDIT_FIELDS)[number];
export type BuildingEditForm = { [K in BuildingEditField]?: AdminBuilding[K] | '' };

/** The edit form's starting values: the stored row, with blanks as '' for the inputs. */
export function buildingEditForm(building: AdminBuilding): BuildingEditForm {
  const form: BuildingEditForm = {};
  for (const field of BUILDING_EDIT_FIELDS) {
    const value = building[field];
    (form as Record<BuildingEditField, unknown>)[field] = value ?? (field === 'year_built' || field === 'unit_count' ? null : '');
  }
  return form;
}

const blank = (value: unknown) => value === null || value === undefined || value === '';

/**
 * Only the fields the admin changed. The PATCH writes `'' || null` for every field it is
 * sent, so sending the whole form would overwrite any stored value the form did not start
 * from (that is how notes and owner data were being nulled). Blank, null, and missing all
 * count as the same "empty".
 */
export function buildingEditPatch(original: AdminBuilding, form: BuildingEditForm): BuildingEditForm {
  const patch: BuildingEditForm = {};
  for (const field of BUILDING_EDIT_FIELDS) {
    if (!(field in form)) continue;
    const next = form[field];
    const prev = original[field];
    if (blank(next) && blank(prev)) continue;
    if (next === prev) continue;
    (patch as Record<BuildingEditField, unknown>)[field] = next;
  }
  return patch;
}

/** The row as the server stores it after `patch`: blanks become null, as the PATCH writes them. */
export function applyBuildingPatch(building: AdminBuilding, patch: BuildingEditForm): AdminBuilding {
  const updated: AdminBuilding = { ...building };
  for (const field of BUILDING_EDIT_FIELDS) {
    if (!(field in patch)) continue;
    const value = patch[field];
    (updated as unknown as Record<BuildingEditField, unknown>)[field] = blank(value) ? null : value;
  }
  return updated;
}
