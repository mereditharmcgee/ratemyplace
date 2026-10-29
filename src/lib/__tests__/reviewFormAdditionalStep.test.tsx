import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
import AdditionalStep from '../../components/reviews/form-steps/AdditionalStep';
import { pestTypeOptions } from '../formOptions';
import type { Tenancy, ReviewData } from '../../components/reviews/form-steps/types';

afterEach(() => {
  cleanup();
});

const baseTenancy: Tenancy = { tenure: 18, moveOutYear: 'current' };

const baseReview: ReviewData = {
  reviewTitle: '',
  landlordName: '',
  hasSeparateManager: true,
  propertyManagerName: '',
  wouldRecommend: 'yes',
  comments: '',
  hadPestIssues: false,
  pestTypesExperienced: [],
  hadHeatIssues: false,
  hadWaterIssues: false,
  hadSecurityDepositIssues: false,
  hadEvictionThreats: false,
  housingVouchers: null,
  safelyLit: null,
};

describe('AdditionalStep labeling', () => {
  it('associates the previously-unlabeled tenure, landlord, title, and comments controls', () => {
    render(
      <AdditionalStep
        tenancy={baseTenancy}
        review={baseReview}
        onTenancyChange={vi.fn()}
        onReviewChange={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />
    );

    expect(screen.getByLabelText(/how long did you live at this address/i)).toBeTruthy();
    expect(screen.getByLabelText(/when did you move out/i)).toBeTruthy();
    expect(screen.getByLabelText(/who was your landlord or property manager/i)).toBeTruthy();
    expect(screen.getByLabelText(/who manages the property/i)).toBeTruthy();
    expect(screen.getByLabelText(/review title/i)).toBeTruthy();
    expect(screen.getByLabelText(/additional comments/i)).toBeTruthy();
  });

  it('gives the "would recommend" radio group a shared name for arrow-key navigation', () => {
    render(
      <AdditionalStep
        tenancy={baseTenancy}
        review={baseReview}
        onTenancyChange={vi.fn()}
        onReviewChange={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />
    );

    const group = screen.getByRole('group', { name: /would you recommend this unit/i });
    const radios = group.querySelectorAll('input[type="radio"]') as NodeListOf<HTMLInputElement>;

    expect(radios.length).toBe(3);
    const names = new Set(Array.from(radios).map((r) => r.name));
    expect(names.size).toBe(1);
    expect(names.has('')).toBe(false);
  });

  it('names the pest chips as one group, and shows keyboard focus on the chip', () => {
    render(
      <AdditionalStep
        tenancy={baseTenancy}
        review={{ ...baseReview, hadPestIssues: true }}
        onTenancyChange={vi.fn()}
        onReviewChange={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />
    );

    const group = screen.getByRole('group', { name: 'What pests did you encounter?' });
    const boxes = within(group).getAllByRole('checkbox');
    expect(boxes).toHaveLength(pestTypeOptions.length);
    for (const pest of pestTypeOptions) {
      expect(within(group).getByRole('checkbox', { name: pest.label })).toBeTruthy();
    }

    // The checkbox is visually hidden, so its keyboard focus is drawn on the chip around it.
    const chip = boxes[0].closest('label') as HTMLLabelElement;
    for (const token of [
      'has-[:focus-visible]:outline-2',
      'has-[:focus-visible]:outline-offset-2',
      'has-[:focus-visible]:outline-teal-700',
    ]) {
      expect(chip.className.split(/\s+/)).toContain(token);
    }
  });

  it('uses the teal-700 focus ring on every control', () => {
    const { container } = render(
      <AdditionalStep
        tenancy={baseTenancy}
        review={{ ...baseReview, hadPestIssues: true }}
        onTenancyChange={vi.fn()}
        onReviewChange={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />
    );
    const rings = Array.from(container.querySelectorAll('[class*="focus:ring-teal-"]')).map(
      (el) => el.className.match(/focus:ring-teal-\d+/)?.[0],
    );
    expect(rings.length).toBeGreaterThan(0);
    expect(new Set(rings)).toEqual(new Set(['focus:ring-teal-700']));
  });
});
