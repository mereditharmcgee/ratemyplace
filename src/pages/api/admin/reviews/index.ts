import type { APIContext } from 'astro';
import { getDB } from '../../../../lib/db';
import { logError } from '../../../../lib/logger';
import { reviewFlags, VELOCITY_WINDOW_SECONDS, type ReviewFlagCode } from '../../../../lib/reviewFlags';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** The two counts the list reads only to compute signals; neither reaches the response. */
interface SignalCounts {
  id: string;
  review_title: unknown;
  review_text: unknown;
  comments: unknown;
  landlord_name: unknown;
  property_manager_name: unknown;
  building_ordinal: number;
  other_reviews_here: number;
  [column: string]: unknown;
}

/**
 * Advisory signals for one row (src/lib/reviewFlags.ts): codes only, never stored, never read
 * by any moderation action. A row whose scan throws gets none, and the log names the review and
 * the error type only, never field text, so one row can never take the queue down.
 */
function withSignals(row: SignalCounts): Record<string, unknown> {
  const { building_ordinal, other_reviews_here, ...rest } = row;
  let integrity_flags: ReviewFlagCode[] = [];
  try {
    integrity_flags = reviewFlags({
      text: {
        review_title: row.review_title as string | null,
        review_text: row.review_text as string | null,
        comments: row.comments as string | null,
        landlord_name: row.landlord_name as string | null,
        property_manager_name: row.property_manager_name as string | null,
      },
      buildingOrdinal: Number(building_ordinal),
      otherReviewsHere: Number(other_reviews_here),
    });
  } catch (error) {
    logError('review_flags_failed', {
      review_id: row.id,
      error_name: error instanceof Error ? error.name : typeof error,
    });
  }
  return { ...rest, integrity_flags };
}

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

  // Pagination params (clamped — see DEFAULT_LIMIT/MAX_LIMIT)
  const url = new URL(context.request.url);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  const requestedLimit = parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, requestedLimit));

  try {
    const db = getDB(context);

    // Status counts across the WHOLE dataset (not the paginated slice) so the
    // filter-badge totals stay accurate when the user has only loaded the first page.
    const statusCountsRow = await db.prepare(`
      SELECT
        COUNT(*) as all_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END) as flagged
      FROM reviews
    `).first<{ all_count: number; pending: number; approved: number; rejected: number; flagged: number }>();

    const reviews = await db.prepare(`
      SELECT
        r.id,
        r.user_id,
        u.email as user_email,
        r.building_id,
        b.address as building_address,
        b.slug as building_slug,
        b.city as building_city,
        b.state as building_state,
        b.landlord_id as building_landlord_id,
        l.name as building_landlord_name,
        r.landlord_name,
        r.review_title,
        r.review_text,
        r.comments,
        r.overall_score,
        r.status,
        r.is_verified,
        r.created_at,
        r.move_in_year,
        r.move_in_season,
        r.unit_type,
        r.unit_number,
        r.rent_amount,
        r.would_recommend_new,
        r.property_manager_name,
        -- Signals only (src/lib/reviewFlags.ts), removed before the response: this review's
        -- place among its building's reviews in the window ending at its own time, ties by id,
        -- and the same account's other reviews of the same building.
        (SELECT COUNT(*) FROM reviews o
           WHERE o.building_id = r.building_id
             AND o.created_at > r.created_at - ?
             AND (o.created_at < r.created_at OR (o.created_at = r.created_at AND o.id <= r.id))) AS building_ordinal,
        (SELECT COUNT(*) FROM reviews o
           WHERE o.user_id = r.user_id AND o.building_id = r.building_id AND o.id <> r.id) AS other_reviews_here
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      JOIN buildings b ON r.building_id = b.id
      LEFT JOIN landlords l ON b.landlord_id = l.id
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(VELOCITY_WINDOW_SECONDS, limit, offset).all<SignalCounts>();

    return new Response(JSON.stringify({
      reviews: reviews.results.map(withSignals),
      total: statusCountsRow?.all_count ?? 0,
      offset,
      limit,
      statusCounts: {
        all: statusCountsRow?.all_count ?? 0,
        pending: statusCountsRow?.pending ?? 0,
        approved: statusCountsRow?.approved ?? 0,
        rejected: statusCountsRow?.rejected ?? 0,
        flagged: statusCountsRow?.flagged ?? 0,
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch reviews' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
