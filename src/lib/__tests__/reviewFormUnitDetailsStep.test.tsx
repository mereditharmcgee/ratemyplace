import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import UnitDetailsStep from '../../components/reviews/form-steps/UnitDetailsStep';
import { amenityOptions } from '../formOptions';
import type { UnitDetails } from '../../components/reviews/form-steps/types';

afterEach(() => {
  cleanup();
});

const baseUnitDetails: UnitDetails = {
  unitNumber: '',
  bedrooms: '1',
  bathrooms: '1',
  squareFootage: '',
  rentAmount: '',
  moveInMonth: '',
  moveInYear: '',
  amenities: [],
  utilitiesIncluded: [],
  laundryType: 'none',
  laundryCostPerLoad: '',
  estimatedMonthlyUtilities: '',
  parkingType: '',
  petTypes: [],
};

function renderStep(overrides: Partial<UnitDetails> = {}) {
  const onChange = vi.fn();
  const onNext = vi.fn();
  render(
    <UnitDetailsStep
      building={null}
      unitDetails={{ ...baseUnitDetails, ...overrides }}
      onChange={onChange}
      onNext={onNext}
    />
  );
  return { onChange, onNext };
}

describe('UnitDetailsStep labeling', () => {
  it('associates every control needed for getByLabelText lookups', () => {
    renderStep();

    expect(screen.getByLabelText('Bedrooms')).toBeTruthy();
    expect(screen.getByLabelText('Bathrooms')).toBeTruthy();
    expect(screen.getByLabelText(/Move-in month/)).toBeTruthy();
    expect(screen.getByLabelText(/Move-in year/)).toBeTruthy();
    expect(screen.getByLabelText(/Unit number/i)).toBeTruthy();
  });

  it('gives amenity checkboxes a 40px-plus tap target and accent styling', () => {
    renderStep();

    for (const amenity of amenityOptions) {
      const checkbox = screen.getByLabelText(amenity.label) as HTMLInputElement;
      expect(checkbox.type).toBe('checkbox');
      expect(checkbox.className).toContain('h-5');

      const label = checkbox.closest('label');
      expect(label).toBeTruthy();
      expect(label!.className).toContain('py-2');
    }
  });
});
