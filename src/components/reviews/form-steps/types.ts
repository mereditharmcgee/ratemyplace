/**
 * Shared types for ReviewForm step components
 */

export interface Building {
  id: string;
  address: string;
  neighborhood?: string;
  city: string;
}

export interface PlaceDetails {
  placeId: string;
  streetAddress: string;
  neighborhood?: string;
  city: string;
  state: string;
  zipCode?: string;
  latitude?: number;
  longitude?: number;
}

export interface PlaceData extends PlaceDetails {
  existingBuilding?: Building | null;
}

export interface UnitDetails {
  unitNumber: string;
  bedrooms: string;
  bathrooms: string;
  squareFootage: string;
  rentAmount: string;
  amenities: string[];
  utilitiesIncluded: string[];
  laundryType: 'in_unit' | 'in_building' | 'coin_op' | 'none';
  laundryCostPerLoad: string;
  estimatedMonthlyUtilities: string;
}

export interface Tenancy {
  tenure: number;
  moveOutYear: string;
}

export interface ReviewData {
  wouldRecommend: string;
  comments: string;
  hadPestIssues: boolean;
  hadHeatIssues: boolean;
  hadWaterIssues: boolean;
  hadSecurityDepositIssues: boolean;
  hadEvictionThreats: boolean;
}

export type Step = 'address' | 'unit-details' | 'unit-rating' | 'building-rating' | 'landlord-rating' | 'additional' | 'confirm';

export const STEPS: { id: Step; title: string }[] = [
  { id: 'address', title: 'Address' },
  { id: 'unit-details', title: 'Unit Details' },
  { id: 'unit-rating', title: 'Your Unit' },
  { id: 'building-rating', title: 'Building' },
  { id: 'landlord-rating', title: 'Landlord' },
  { id: 'additional', title: 'Additional' },
  { id: 'confirm', title: 'Submit' },
];
