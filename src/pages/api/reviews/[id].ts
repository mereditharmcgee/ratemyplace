import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { calculateOverallScore } from '../../../lib/scoring';

export interface ReviewDetail {
  id: string;
  user_id: string;
  building_id: string;
  building_address: string;
  building_slug: string;
  neighborhood: string | null;
  city: string;
  move_in_year: number;
  move_in_season: string;
  move_out_year: number | null;
  move_out_season: string | null;
  is_current_tenant: boolean;
  unit_type: string;
  rent_amount: number | null;
  score_building_quality: number | null;
  score_maintenance: number | null;
  score_pest_control: number | null;
  score_safety: number | null;
  score_noise: number | null;
  score_landlord_responsiveness: number | null;
  score_landlord_communication: number | null;
  score_landlord_fairness: number | null;
  score_lease_clarity: number | null;
  score_deposit_handling: number | null;
  score_rent_value: number | null;
  score_amenities: number | null;
  overall_score: number;
  review_title: string | null;
  review_text: string | null;
  had_pest_issues: boolean;
  had_heat_issues: boolean;
  had_water_issues: boolean;
  had_security_deposit_issues: boolean;
  had_eviction_threat: boolean;
  would_recommend: boolean;
  status: string;
  is_verified: boolean;
  created_at: number;
}

export async function GET(context: APIContext): Promise<Response> {
  const { id } = context.params;

  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);

    const review = await db.prepare(`
      SELECT
        r.*,
        b.address as building_address,
        b.slug as building_slug,
        b.neighborhood,
        b.city
      FROM reviews r
      JOIN buildings b ON r.building_id = b.id
      WHERE r.id = ?
    `).bind(id).first<any>();

    if (!review) {
      return new Response(JSON.stringify({ error: 'Review not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check ownership
    if (review.user_id !== context.locals.user.id) {
      return new Response(JSON.stringify({ error: 'Not authorized to view this review' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Convert integer booleans to real booleans
    const result: ReviewDetail = {
      ...review,
      is_current_tenant: review.is_current_tenant === 1,
      had_pest_issues: review.had_pest_issues === 1,
      had_heat_issues: review.had_heat_issues === 1,
      had_water_issues: review.had_water_issues === 1,
      had_security_deposit_issues: review.had_security_deposit_issues === 1,
      had_eviction_threat: review.had_eviction_threat === 1,
      would_recommend: review.would_recommend === 1,
      is_verified: review.is_verified === 1
    };

    return new Response(JSON.stringify({ review: result }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching review:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch review' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function PATCH(context: APIContext): Promise<Response> {
  const { id } = context.params;

  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const db = getDB((context.locals as any).runtime);

    // Verify ownership
    const existing = await db.prepare('SELECT user_id, building_id FROM reviews WHERE id = ?')
      .bind(id)
      .first<{ user_id: string; building_id: string }>();

    if (!existing) {
      return new Response(JSON.stringify({ error: 'Review not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (existing.user_id !== context.locals.user.id) {
      return new Response(JSON.stringify({ error: 'Not authorized to edit this review' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await context.request.json();

    // Extract editable fields
    const scores: Record<string, number | null> = {
      building_quality: body.score_building_quality ?? null,
      maintenance: body.score_maintenance ?? null,
      pest_control: body.score_pest_control ?? null,
      safety: body.score_safety ?? null,
      noise: body.score_noise ?? null,
      landlord_responsiveness: body.score_landlord_responsiveness ?? null,
      landlord_communication: body.score_landlord_communication ?? null,
      landlord_fairness: body.score_landlord_fairness ?? null,
      lease_clarity: body.score_lease_clarity ?? null,
      deposit_handling: body.score_deposit_handling ?? null,
      rent_value: body.score_rent_value ?? null,
      amenities: body.score_amenities ?? null,
    };

    // Calculate overall score
    const validScores = Object.fromEntries(
      Object.entries(scores).filter(([_, v]) => v !== null)
    ) as Record<string, number>;
    const overallScore = calculateOverallScore(validScores);

    // Update review
    await db.prepare(`
      UPDATE reviews SET
        unit_type = ?,
        rent_amount = ?,
        score_building_quality = ?,
        score_maintenance = ?,
        score_pest_control = ?,
        score_safety = ?,
        score_noise = ?,
        score_landlord_responsiveness = ?,
        score_landlord_communication = ?,
        score_landlord_fairness = ?,
        score_lease_clarity = ?,
        score_deposit_handling = ?,
        score_rent_value = ?,
        score_amenities = ?,
        overall_score = ?,
        review_title = ?,
        review_text = ?,
        had_pest_issues = ?,
        had_heat_issues = ?,
        had_water_issues = ?,
        had_security_deposit_issues = ?,
        had_eviction_threat = ?,
        would_recommend = ?,
        updated_at = unixepoch()
      WHERE id = ?
    `).bind(
      body.unit_type,
      body.rent_amount ?? null,
      scores.building_quality,
      scores.maintenance,
      scores.pest_control,
      scores.safety,
      scores.noise,
      scores.landlord_responsiveness,
      scores.landlord_communication,
      scores.landlord_fairness,
      scores.lease_clarity,
      scores.deposit_handling,
      scores.rent_value,
      scores.amenities,
      overallScore,
      body.review_title ?? null,
      body.review_text ?? null,
      body.had_pest_issues ? 1 : 0,
      body.had_heat_issues ? 1 : 0,
      body.had_water_issues ? 1 : 0,
      body.had_security_deposit_issues ? 1 : 0,
      body.had_eviction_threat ? 1 : 0,
      body.would_recommend ? 1 : 0,
      id
    ).run();

    // Get building slug for redirect
    const building = await db.prepare('SELECT slug FROM buildings WHERE id = ?')
      .bind(existing.building_id)
      .first<{ slug: string }>();

    return new Response(JSON.stringify({
      success: true,
      buildingSlug: building?.slug
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating review:', error);
    return new Response(JSON.stringify({ error: 'Failed to update review' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
