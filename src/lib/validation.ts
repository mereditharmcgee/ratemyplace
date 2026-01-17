import type { ReviewFormData, Season, UnitType } from './types';

const validSeasons: Season[] = ['winter', 'spring', 'summer', 'fall'];
const validUnitTypes: UnitType[] = ['studio', '1br', '2br', '3br', '4br+', 'house'];

export interface ValidationError {
  field: string;
  message: string;
}

export function validateReviewForm(data: Partial<ReviewFormData>): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required fields
  if (!data.building_id) {
    errors.push({ field: 'building_id', message: 'Building is required' });
  }

  if (!data.move_in_year || data.move_in_year < 1900 || data.move_in_year > new Date().getFullYear()) {
    errors.push({ field: 'move_in_year', message: 'Valid move-in year is required' });
  }

  if (!data.move_in_season || !validSeasons.includes(data.move_in_season)) {
    errors.push({ field: 'move_in_season', message: 'Valid move-in season is required' });
  }

  if (!data.unit_type || !validUnitTypes.includes(data.unit_type)) {
    errors.push({ field: 'unit_type', message: 'Valid unit type is required' });
  }

  // Move-out validation (required if not current tenant)
  if (!data.is_current_tenant) {
    if (data.move_out_year) {
      if (data.move_out_year < 1900 || data.move_out_year > new Date().getFullYear()) {
        errors.push({ field: 'move_out_year', message: 'Valid move-out year is required' });
      }

      if (data.move_in_year && data.move_out_year < data.move_in_year) {
        errors.push({ field: 'move_out_year', message: 'Move-out date must be after move-in date' });
      }
    }

    if (data.move_out_season && !validSeasons.includes(data.move_out_season)) {
      errors.push({ field: 'move_out_season', message: 'Valid move-out season is required' });
    }
  }

  // Rent validation
  if (data.rent_amount !== undefined && data.rent_amount !== null) {
    if (data.rent_amount < 0 || data.rent_amount > 50000) {
      errors.push({ field: 'rent_amount', message: 'Rent amount must be between $0 and $50,000' });
    }
  }

  // Score validation
  if (data.scores) {
    const scoreFields = [
      'building_quality',
      'maintenance',
      'pest_control',
      'safety',
      'noise',
      'landlord_responsiveness',
      'landlord_communication',
      'landlord_fairness',
      'lease_clarity',
      'deposit_handling',
      'rent_value',
      'amenities',
    ] as const;

    for (const field of scoreFields) {
      const score = data.scores[field];
      if (score !== undefined && score !== null) {
        if (score < 1 || score > 5 || !Number.isInteger(score)) {
          errors.push({ field: `scores.${field}`, message: `${field} must be between 1 and 5` });
        }
      }
    }
  }

  // Review text validation
  if (data.review_title && data.review_title.length > 200) {
    errors.push({ field: 'review_title', message: 'Title must be 200 characters or less' });
  }

  if (data.review_text && data.review_text.length > 5000) {
    errors.push({ field: 'review_text', message: 'Review must be 5000 characters or less' });
  }

  return errors;
}

export function sanitizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/<[^>]*>/g, '');
}
