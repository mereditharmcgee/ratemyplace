import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import AdditionalStep from '../../components/reviews/form-steps/AdditionalStep';
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
});
