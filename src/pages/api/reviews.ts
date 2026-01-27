import type { APIContext } from 'astro';
import { getDB } from '../../lib/db';
import { calculateOverallScore, calculateDomainScores, ALL_SCORE_FIELDS } from '../../lib/scoring';
import { generateIdFromEntropySize } from 'lucia';

export async function POST(context: APIContext): Promise<Response> {
  // Require authentication
  if (!context.locals.user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const formData = await context.request.formData();

    const buildingId = formData.get('building_id') as string;
    if (!buildingId) {
      return new Response(JSON.stringify({ error: 'Building ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Tenancy info
    const tenureMonths = formData.get('tenure_months') ? parseInt(formData.get('tenure_months') as string) : null;
    const moveOutYearNew = formData.get('move_out_year') as string || null;
    const isCurrentTenant = moveOutYearNew === 'current' ? 1 : 0;

    // Unit details
    const unitType = formData.get('unit_type') as string || 'unknown';
    const unitNumber = formData.get('unit_number') as string || null;
    const bedrooms = formData.get('bedrooms') as string || null;
    const bathrooms = formData.get('bathrooms') as string || null;
    const squareFootage = formData.get('square_footage') ? parseInt(formData.get('square_footage') as string) : null;
    const rentAmount = formData.get('rent_amount') ? parseInt(formData.get('rent_amount') as string) : null;
    const amenities = formData.get('amenities') as string || '[]';
    const utilitiesIncluded = formData.get('utilities_included') as string || '[]';

    // Laundry info
    const laundryType = formData.get('laundry_type') as string || null;
    const laundryCostPerLoad = formData.get('laundry_cost_per_load') ? parseFloat(formData.get('laundry_cost_per_load') as string) : null;
    const estimatedMonthlyUtilities = formData.get('estimated_monthly_utilities') ? parseInt(formData.get('estimated_monthly_utilities') as string) : null;

    // Collect all 27 survey scores
    const scores: Record<string, number | null> = {};
    for (const field of ALL_SCORE_FIELDS) {
      const value = formData.get(field);
      scores[field] = value ? parseInt(value as string) : null;
    }

    // Calculate domain scores and overall
    const domainScores = calculateDomainScores(scores);
    const overallScore = domainScores.overall ?? 0;

    // Additional info
    const wouldRecommendNew = formData.get('would_recommend') as string || null;
    const comments = formData.get('comments') as string || null;

    const db = getDB((context.locals as any).runtime);

    // Verify building exists and get its slug
    const building = await db.prepare('SELECT id, slug FROM buildings WHERE id = ?')
      .bind(buildingId)
      .first<{ id: string; slug: string }>();

    if (!building) {
      return new Response(JSON.stringify({ error: 'Building not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const reviewId = generateIdFromEntropySize(10);

    // Insert review with all 27 score fields
    await db.prepare(`
      INSERT INTO reviews (
        id, user_id, building_id,
        tenure_months, move_out_year_new, is_current_tenant,
        unit_type, unit_number, bedrooms, bathrooms, square_footage, rent_amount,
        amenities, utilities_included,
        laundry_type, laundry_cost_per_load, estimated_monthly_utilities,
        unit_structural, unit_plumbing, unit_electrical, unit_climate, unit_ventilation,
        unit_pests, unit_mold, unit_appliances, unit_layout, unit_accuracy,
        building_common_areas, building_security, building_exterior,
        building_noise_neighbors, building_noise_external, building_mail,
        building_laundry, building_parking, building_trash,
        landlord_maintenance, landlord_communication, landlord_professionalism,
        landlord_lease_clarity, landlord_privacy, landlord_deposit,
        landlord_rent_practices, landlord_non_retaliation,
        overall_score,
        would_recommend_new, comments,
        status,
        move_in_year, move_in_season
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?,
        ?, ?,
        ?,
        ?, ?
      )
    `).bind(
      reviewId,
      context.locals.user.id,
      buildingId,
      tenureMonths,
      moveOutYearNew,
      isCurrentTenant,
      unitType,
      unitNumber,
      bedrooms,
      bathrooms,
      squareFootage,
      rentAmount,
      amenities,
      utilitiesIncluded,
      laundryType,
      laundryCostPerLoad,
      estimatedMonthlyUtilities,
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
      comments,
      'pending',
      // Legacy fields with defaults
      new Date().getFullYear(),
      'winter'
    ).run();

    return new Response(JSON.stringify({
      success: true,
      reviewId,
      buildingSlug: building.slug,
      domainScores
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Review submission error:', error);
    return new Response(JSON.stringify({ error: 'Failed to submit review' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
