/**
 * The example review on /auth/signup: made-up data the real review card renders, so a person
 * sees what readers will see before they make an account (MASTER.md section 5, "User
 * communication").
 *
 * The data has no address, no names, no unit number and no account, and the component that
 * shows it links to no building. The sign-up page is noindex with no structured data, so the
 * example is never read as a real review.
 *
 * Leaf module: no runtime imports.
 */

/**
 * Every user-facing string the example adds, in one place for the owner to edit.
 *
 * `hidden` must stay true to the code. Today: review cards show no name or email
 * (ReviewCard.astro), the unit number is admin-only, and rent and square footage show only as
 * ranges (reviewDisplay.ts). Change this line if any of that changes.
 */
export const EXAMPLE_REVIEW_COPY = {
  heading: 'How your review will look',
  label: 'Example, not a real review',
  shown: 'Readers see your ratings and what you wrote, your unit type, when you lived there by season and year, and your rent and size as ranges.',
  hidden: 'They never see your name, your email, your unit number, or your exact rent and size.',
  title: 'Warm in winter, slow on repairs',
  text: 'The heat worked all winter and the kitchen was in good shape. Repairs usually took a week or two. The laundry room was clean and easy to use.',
} as const;

/** The review row the example card renders: the columns ReviewCard reads, nothing else. */
export interface ExampleReviewRow {
  id: string;
  review_title: string;
  review_text: string;
  is_verified: number;
  unit_type: string;
  bedrooms: string;
  bathrooms: string;
  rent_amount: number;
  square_footage: number;
  move_in_season: string;
  move_in_year: number;
  move_in_given: 'season_and_year';
  move_out_year_new: string;
  is_current_tenant: number;
  would_recommend_new: 'yes';
  utilities_included: string;
  laundry_type: string;
  [score: string]: string | number | null;
}

/**
 * The example review, dated from `currentYear` so it never goes stale: moved in two falls
 * ago, moved out last year. Rent and size are exact here only because the card is what turns
 * them into ranges, which is the point of showing it.
 */
export function exampleReview(currentYear: number): ExampleReviewRow {
  return {
    id: 'example-review',
    review_title: EXAMPLE_REVIEW_COPY.title,
    review_text: EXAMPLE_REVIEW_COPY.text,
    is_verified: 0,
    unit_type: '2br',
    bedrooms: '2',
    bathrooms: '1',
    rent_amount: 2400,
    square_footage: 850,
    move_in_season: 'fall',
    move_in_year: currentYear - 2,
    move_in_given: 'season_and_year',
    move_out_year_new: String(currentYear - 1),
    is_current_tenant: 0,
    would_recommend_new: 'yes',
    utilities_included: JSON.stringify(['heat', 'hot_water']),
    laundry_type: 'in_building',
    unit_structural: 4,
    unit_plumbing: 4,
    unit_electrical: 4,
    unit_climate: 5,
    unit_ventilation: 3,
    unit_pests: 4,
    unit_mold: 4,
    unit_appliances: 4,
    unit_layout: 4,
    unit_accuracy: 4,
    building_common_areas: 4,
    building_security: 3,
    building_exterior: 4,
    building_noise_neighbors: 3,
    building_noise_external: 3,
    building_mail: 4,
    building_laundry: 4,
    // Left unrated, so the example also shows how a skipped question reads.
    building_parking: null,
    building_trash: 4,
    landlord_maintenance: 2,
    landlord_communication: 3,
    landlord_professionalism: 3,
    landlord_lease_clarity: 4,
    landlord_privacy: 4,
    landlord_deposit: 4,
    landlord_rent_practices: 3,
    landlord_non_retaliation: 4,
  };
}
