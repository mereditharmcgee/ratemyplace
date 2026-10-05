import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';
import { recencyWeightedOverallSql, currentReviewYear } from '../../../../lib/scoring-sql';
import { adminBuildingsWhere, parseAdminBuildingsFilter } from '../../../../lib/admin/buildingsFilter';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(context: APIContext): Promise<Response> {
  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Require admin
  if (!context.locals.user.isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin access required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Pagination params
  const url = new URL(context.request.url);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const requestedLimit = parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, requestedLimit));
  // Server-side filters: the table holds tens of thousands of seeded parcels, so a client
  // filter over the loaded page could never find most rows.
  const filter = parseAdminBuildingsFilter(url.searchParams);
  const where = adminBuildingsWhere(filter);

  try {
    const db = getDB(context);
    const currentYear = currentReviewYear();

    // Aggregate stats across the WHOLE dataset (not the paginated slice) so the
    // four stat cards stay accurate when the user has only loaded the first page.
    const statsRow = await db.prepare(`
      SELECT
        COUNT(DISTINCT b.id) as total_buildings,
        COUNT(DISTINCT CASE WHEN r.id IS NOT NULL THEN b.id END) as with_reviews,
        COUNT(DISTINCT CASE WHEN b.landlord_id IS NOT NULL THEN b.id END) as with_landlords,
        COUNT(r.id) as total_reviews
      FROM buildings b
      LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
    `).first<{ total_buildings: number; with_reviews: number; with_landlords: number; total_reviews: number }>();

    // `total` is the filtered count, so "Load more" and the footer track the active filter;
    // `stats` above stays global.
    const totalRow = await db.prepare(`
      SELECT COUNT(*) as total FROM buildings b ${where.sql}
    `).bind(...where.binds).first<{ total: number }>();

    const buildings = await db.prepare(`
      SELECT
        b.id,
        b.address,
        b.slug,
        b.neighborhood,
        b.city,
        b.state,
        b.zip_code,
        b.latitude,
        b.longitude,
        b.year_built,
        b.unit_count,
        b.building_type,
        b.landlord_id,
        l.name as landlord_name,
        b.property_manager_id,
        pm.name as property_manager_name,
        b.created_at,
        -- Admin-only fields. The edit form starts from these, so a row without them would
        -- null the stored notes and owner data on the next save.
        b.admin_notes,
        b.owner_name,
        b.owner_entity,
        b.owner_website,
        COUNT(r.id) as review_count,
        ${recencyWeightedOverallSql('r', currentYear)} as avg_score
      FROM buildings b
      LEFT JOIN landlords l ON b.landlord_id = l.id
      LEFT JOIN property_managers pm ON b.property_manager_id = pm.id
      LEFT JOIN reviews r ON b.id = r.building_id AND r.status = 'approved'
      ${where.sql}
      GROUP BY b.id
      -- id breaks created_at ties: seeded rows share timestamps, and OFFSET paging over a
      -- tied sort repeats some rows and skips others.
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ? OFFSET ?
    `).bind(...where.binds, limit, offset).all();

    const landlordFilter = filter.landlord
      ? {
          landlord: await db
            .prepare('SELECT id, name FROM landlords WHERE id = ?')
            .bind(filter.landlord)
            .first<{ id: string; name: string }>(),
        }
      : undefined;

    return new Response(JSON.stringify({
      buildings: buildings.results,
      total: totalRow?.total ?? 0,
      offset,
      limit,
      stats: {
        total_buildings: statsRow?.total_buildings ?? 0,
        with_reviews: statsRow?.with_reviews ?? 0,
        with_landlords: statsRow?.with_landlords ?? 0,
        total_reviews: statsRow?.total_reviews ?? 0,
      },
      ...(landlordFilter ? { filter: landlordFilter } : {}),
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching buildings:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch buildings' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
