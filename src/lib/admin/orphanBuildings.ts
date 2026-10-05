import { BOSTON_LOCALITY_NAMES } from '../bostonLocalities';

/**
 * Cities whose buildings are never orphans, lowercased the way the predicate compares them:
 * Boston, every Boston locality name, and New Haven (production has real New Haven reviews).
 */
const KEPT_CITIES: readonly string[] = Array.from(
  new Set(['boston', ...BOSTON_LOCALITY_NAMES.map((name) => name.toLowerCase()), 'new haven']),
);

/**
 * The one spelling of "an orphan building": a row a user added (never a seeded parcel), with
 * no review in any status, that nobody has saved, whose city (the part before any comma, so
 * "Allston, MA" reads as Allston) is not Boston, a Boston locality, or New Haven. A blank or
 * missing city is not an orphan: we cannot tell where the building is, so it is not ours to
 * delete in bulk.
 *
 * Shared by the admin buildings list (`?filter=orphans`) and the cleanup endpoint, so what
 * the toggle shows is exactly what the cleanup button deletes. The fragment expects the
 * buildings table aliased `b`. The city list is bound, never interpolated.
 */
export function orphanBuildingsWhere(): { sql: string; binds: string[] } {
  const placeholders = KEPT_CITIES.map(() => '?').join(', ');
  const sql = `(
    b.source = 'user'
    AND NOT EXISTS (SELECT 1 FROM reviews r_o WHERE r_o.building_id = b.id)
    AND NOT EXISTS (SELECT 1 FROM saved_buildings s_o WHERE s_o.building_id = b.id)
    AND TRIM(COALESCE(b.city, '')) <> ''
    AND LOWER(TRIM(CASE
      WHEN instr(COALESCE(b.city, ''), ',') > 0 THEN substr(b.city, 1, instr(b.city, ',') - 1)
      ELSE COALESCE(b.city, '')
    END)) NOT IN (${placeholders})
  )`;
  return { sql, binds: [...KEPT_CITIES] };
}
