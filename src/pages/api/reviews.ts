import type { APIContext } from 'astro';
import { getDB } from '../../lib/db';
import { calculateOverallScore } from '../../lib/scoring';
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
    const moveInYear = parseInt(formData.get('move_in_year') as string);
    const moveInSeason = formData.get('move_in_season') as string;
    const isCurrentTenant = formData.get('is_current_tenant') === '1';
    const moveOutYear = !isCurrentTenant ? parseInt(formData.get('move_out_year') as string) : null;
    const moveOutSeason = !isCurrentTenant ? formData.get('move_out_season') as string : null;
    const unitType = formData.get('unit_type') as string;
    const rentAmount = formData.get('rent_amount') ? parseInt(formData.get('rent_amount') as string) : null;

    // Collect scores
    const scores: Record<string, number | null> = {
      building_quality: formData.get('score_building_quality') ? parseInt(formData.get('score_building_quality') as string) : null,
      maintenance: formData.get('score_maintenance') ? parseInt(formData.get('score_maintenance') as string) : null,
      pest_control: formData.get('score_pest_control') ? parseInt(formData.get('score_pest_control') as string) : null,
      safety: formData.get('score_safety') ? parseInt(formData.get('score_safety') as string) : null,
      noise: formData.get('score_noise') ? parseInt(formData.get('score_noise') as string) : null,
      landlord_responsiveness: formData.get('score_landlord_responsiveness') ? parseInt(formData.get('score_landlord_responsiveness') as string) : null,
      landlord_communication: formData.get('score_landlord_communication') ? parseInt(formData.get('score_landlord_communication') as string) : null,
      landlord_fairness: formData.get('score_landlord_fairness') ? parseInt(formData.get('score_landlord_fairness') as string) : null,
      lease_clarity: formData.get('score_lease_clarity') ? parseInt(formData.get('score_lease_clarity') as string) : null,
      deposit_handling: formData.get('score_deposit_handling') ? parseInt(formData.get('score_deposit_handling') as string) : null,
      rent_value: formData.get('score_rent_value') ? parseInt(formData.get('score_rent_value') as string) : null,
      amenities: formData.get('score_amenities') ? parseInt(formData.get('score_amenities') as string) : null,
    };

    // Calculate overall score
    const validScores = Object.fromEntries(
      Object.entries(scores).filter(([_, v]) => v !== null)
    ) as Record<string, number>;
    const overallScore = calculateOverallScore(validScores);

    // Issues
    const hadPestIssues = formData.get('had_pest_issues') === '1';
    const hadHeatIssues = formData.get('had_heat_issues') === '1';
    const hadWaterIssues = formData.get('had_water_issues') === '1';
    const hadSecurityDepositIssues = formData.get('had_deposit_issues') === '1';
    const hadEvictionThreat = formData.get('had_eviction_issues') === '1';
    const wouldRecommend = formData.get('would_recommend') === '1';

    const reviewTitle = formData.get('review_title') as string || null;
    const reviewText = formData.get('review_text') as string || null;

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

    await db.prepare(`
      INSERT INTO reviews (
        id, user_id, building_id,
        move_in_year, move_in_season, move_out_year, move_out_season, is_current_tenant,
        unit_type, rent_amount,
        score_building_quality, score_maintenance, score_pest_control, score_safety, score_noise,
        score_landlord_responsiveness, score_landlord_communication, score_landlord_fairness,
        score_lease_clarity, score_deposit_handling, score_rent_value, score_amenities,
        overall_score,
        review_title, review_text,
        had_pest_issues, had_heat_issues, had_water_issues, had_security_deposit_issues, had_eviction_threat,
        would_recommend, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      reviewId,
      context.locals.user.id,
      buildingId,
      moveInYear,
      moveInSeason,
      moveOutYear,
      moveOutSeason,
      isCurrentTenant ? 1 : 0,
      unitType,
      rentAmount,
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
      reviewTitle,
      reviewText,
      hadPestIssues ? 1 : 0,
      hadHeatIssues ? 1 : 0,
      hadWaterIssues ? 1 : 0,
      hadSecurityDepositIssues ? 1 : 0,
      hadEvictionThreat ? 1 : 0,
      wouldRecommend ? 1 : 0,
      'pending'
    ).run();

    return new Response(JSON.stringify({
      success: true,
      reviewId,
      buildingSlug: building.slug
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
