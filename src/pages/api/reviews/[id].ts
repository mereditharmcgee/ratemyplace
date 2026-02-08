import type { APIContext } from 'astro';
import { getDB } from '../../../lib/db';
import { calculateOverallScore, calculateDomainScores, ALL_SCORE_FIELDS } from '../../../lib/scoring';

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
  move_out_year_new: string | null;
  is_current_tenant: boolean;
  unit_type: string;
  unit_number: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  square_footage: number | null;
  rent_amount: number | null;
  amenities: string | null;
  utilities_included: string | null;
  laundry_type: string | null;
  laundry_cost_per_load: number | null;
  estimated_monthly_utilities: number | null;
  tenure_months: number | null;
  // 27 survey score fields
  unit_structural: number | null;
  unit_plumbing: number | null;
  unit_electrical: number | null;
  unit_climate: number | null;
  unit_ventilation: number | null;
  unit_pests: number | null;
  unit_mold: number | null;
  unit_appliances: number | null;
  unit_layout: number | null;
  unit_accuracy: number | null;
  building_common_areas: number | null;
  building_security: number | null;
  building_exterior: number | null;
  building_noise_neighbors: number | null;
  building_noise_external: number | null;
  building_mail: number | null;
  building_laundry: number | null;
  building_parking: number | null;
  building_trash: number | null;
  landlord_maintenance: number | null;
  landlord_communication: number | null;
  landlord_professionalism: number | null;
  landlord_lease_clarity: number | null;
  landlord_privacy: number | null;
  landlord_deposit: number | null;
  landlord_rent_practices: number | null;
  landlord_non_retaliation: number | null;
  // Legacy score fields (kept for backward compatibility)
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
  comments: string | null;
  had_pest_issues: boolean;
  had_heat_issues: boolean;
  had_water_issues: boolean;
  had_security_deposit_issues: boolean;
  had_eviction_threat: boolean;
  would_recommend: boolean;
  would_recommend_new: string | null;
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

    // Collect all 27 survey scores from the request body
    const scores: Record<string, number | null> = {};
    for (const field of ALL_SCORE_FIELDS) {
      scores[field] = body[field] !== undefined ? (body[field] as number | null) : null;
    }

    // Calculate overall score using the proper weighted scoring
    const overallScore = calculateOverallScore(scores);

    // Handle would_recommend - support both new text format and legacy boolean
    const wouldRecommendNew = body.would_recommend_new || null;
    const wouldRecommendLegacy = wouldRecommendNew === 'yes' ? 1 : wouldRecommendNew === 'no' ? 0 : (body.would_recommend ? 1 : 0);

    // Update review with all 27 score fields + unit details
    await db.prepare(`
      UPDATE reviews SET
        unit_type = ?,
        unit_number = ?,
        bedrooms = ?,
        bathrooms = ?,
        square_footage = ?,
        rent_amount = ?,
        amenities = ?,
        utilities_included = ?,
        laundry_type = ?,
        laundry_cost_per_load = ?,
        estimated_monthly_utilities = ?,
        tenure_months = ?,
        move_out_year_new = ?,
        is_current_tenant = ?,
        unit_structural = ?,
        unit_plumbing = ?,
        unit_electrical = ?,
        unit_climate = ?,
        unit_ventilation = ?,
        unit_pests = ?,
        unit_mold = ?,
        unit_appliances = ?,
        unit_layout = ?,
        unit_accuracy = ?,
        building_common_areas = ?,
        building_security = ?,
        building_exterior = ?,
        building_noise_neighbors = ?,
        building_noise_external = ?,
        building_mail = ?,
        building_laundry = ?,
        building_parking = ?,
        building_trash = ?,
        landlord_maintenance = ?,
        landlord_communication = ?,
        landlord_professionalism = ?,
        landlord_lease_clarity = ?,
        landlord_privacy = ?,
        landlord_deposit = ?,
        landlord_rent_practices = ?,
        landlord_non_retaliation = ?,
        overall_score = ?,
        would_recommend_new = ?,
        would_recommend = ?,
        review_title = ?,
        review_text = ?,
        comments = ?,
        had_pest_issues = ?,
        had_heat_issues = ?,
        had_water_issues = ?,
        had_security_deposit_issues = ?,
        had_eviction_threat = ?,
        updated_at = unixepoch()
      WHERE id = ?
    `).bind(
      body.unit_type,
      body.unit_number || null,
      body.bedrooms || null,
      body.bathrooms || null,
      body.square_footage ? parseInt(body.square_footage) : null,
      body.rent_amount ? parseInt(body.rent_amount) : null,
      body.amenities || null,
      body.utilities_included || null,
      body.laundry_type || null,
      body.laundry_cost_per_load ? parseFloat(body.laundry_cost_per_load) : null,
      body.estimated_monthly_utilities ? parseInt(body.estimated_monthly_utilities) : null,
      body.tenure_months ? parseInt(body.tenure_months) : null,
      body.move_out_year_new || null,
      body.move_out_year_new === 'current' ? 1 : 0,
      // Unit scores (10)
      scores.unit_structural,
      scores.unit_plumbing,
      scores.unit_electrical,
      scores.unit_climate,
      scores.unit_ventilation,
      scores.unit_pests,
      scores.unit_mold,
      scores.unit_appliances,
      scores.unit_layout,
      scores.unit_accuracy,
      // Building scores (9)
      scores.building_common_areas,
      scores.building_security,
      scores.building_exterior,
      scores.building_noise_neighbors,
      scores.building_noise_external,
      scores.building_mail,
      scores.building_laundry,
      scores.building_parking,
      scores.building_trash,
      // Landlord scores (8)
      scores.landlord_maintenance,
      scores.landlord_communication,
      scores.landlord_professionalism,
      scores.landlord_lease_clarity,
      scores.landlord_privacy,
      scores.landlord_deposit,
      scores.landlord_rent_practices,
      scores.landlord_non_retaliation,
      // Overall
      overallScore,
      wouldRecommendNew,
      wouldRecommendLegacy,
      body.review_title ?? null,
      body.review_text ?? null,
      body.comments ?? null,
      body.had_pest_issues ? 1 : 0,
      body.had_heat_issues ? 1 : 0,
      body.had_water_issues ? 1 : 0,
      body.had_security_deposit_issues ? 1 : 0,
      body.had_eviction_threat ? 1 : 0,
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
