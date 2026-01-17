export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
}

export interface Landlord {
  id: string;
  name: string;
  slug: string;
  description?: string;
  website?: string;
  phone?: string;
  email?: string;
  created_at: number;
  updated_at: number;
}

export interface Building {
  id: string;
  landlord_id?: string;
  address: string;
  slug: string;
  neighborhood?: string;
  city: string;
  state: string;
  zip_code?: string;
  latitude?: number;
  longitude?: number;
  year_built?: number;
  unit_count?: number;
  building_type?: string;
  created_at: number;
  updated_at: number;
}

export type Season = 'winter' | 'spring' | 'summer' | 'fall';

export type UnitType = 'studio' | '1br' | '2br' | '3br' | '4br+' | 'house';

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'flagged';

export interface Review {
  id: string;
  user_id: string;
  building_id: string;

  move_in_year: number;
  move_in_season: Season;
  move_out_year?: number;
  move_out_season?: Season;
  is_current_tenant: boolean;

  unit_type: UnitType;
  rent_amount?: number;

  score_building_quality?: number;
  score_maintenance?: number;
  score_pest_control?: number;
  score_safety?: number;
  score_noise?: number;
  score_landlord_responsiveness?: number;
  score_landlord_communication?: number;
  score_landlord_fairness?: number;
  score_lease_clarity?: number;
  score_deposit_handling?: number;
  score_rent_value?: number;
  score_amenities?: number;

  overall_score?: number;

  review_title?: string;
  review_text?: string;

  had_pest_issues: boolean;
  had_heat_issues: boolean;
  had_water_issues: boolean;
  had_security_deposit_issues: boolean;
  had_eviction_threat: boolean;
  would_recommend: boolean;

  status: ReviewStatus;
  moderation_notes?: string;

  created_at: number;
  updated_at: number;
}

export interface BuildingScores {
  building_id: string;
  review_count: number;
  avg_overall?: number;
  avg_building_quality?: number;
  avg_maintenance?: number;
  avg_pest_control?: number;
  avg_safety?: number;
  avg_noise?: number;
  avg_landlord_responsiveness?: number;
  avg_landlord_communication?: number;
  avg_landlord_fairness?: number;
  avg_lease_clarity?: number;
  avg_deposit_handling?: number;
  avg_rent_value?: number;
  avg_amenities?: number;
  pct_would_recommend?: number;
  pct_pest_issues?: number;
  pct_heat_issues?: number;
  pct_water_issues?: number;
  pct_deposit_issues?: number;
  updated_at: number;
}

export interface LandlordScores {
  landlord_id: string;
  building_count: number;
  review_count: number;
  avg_overall?: number;
  avg_landlord_responsiveness?: number;
  avg_landlord_communication?: number;
  avg_landlord_fairness?: number;
  avg_lease_clarity?: number;
  avg_deposit_handling?: number;
  pct_would_recommend?: number;
  pct_deposit_issues?: number;
  updated_at: number;
}

export interface ReviewFormData {
  building_id: string;
  move_in_year: number;
  move_in_season: Season;
  move_out_year?: number;
  move_out_season?: Season;
  is_current_tenant: boolean;
  unit_type: UnitType;
  rent_amount?: number;
  scores: {
    building_quality: number;
    maintenance: number;
    pest_control: number;
    safety: number;
    noise: number;
    landlord_responsiveness: number;
    landlord_communication: number;
    landlord_fairness: number;
    lease_clarity: number;
    deposit_handling: number;
    rent_value: number;
    amenities: number;
  };
  issues: {
    pest: boolean;
    heat: boolean;
    water: boolean;
    deposit: boolean;
    eviction: boolean;
  };
  would_recommend: boolean;
  review_title?: string;
  review_text?: string;
}
