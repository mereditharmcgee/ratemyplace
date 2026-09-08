import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import StepIndicator from '../../components/reviews/form-steps/StepIndicator';

afterEach(() => {
  cleanup();
});

describe('StepIndicator', () => {
  it('renders a compact progress bar for the current step (3 of 7)', () => {
    // STEPS order: address, unit-details, unit-rating, building-rating,
    // landlord-rating, additional, confirm — 'unit-rating' is the 3rd step.
    render(<StepIndicator currentStep="unit-rating" />);

    const bar = screen.getByRole('progressbar', { name: /review progress/i });
    // 0, not 1: the bar's width is stepNumber/totalSteps, and assistive tech computes the
    // same percentage as (now - min) / (max - min). With a min of 1, step 1 of 7 is announced
    // as 0% while the bar visibly shows a seventh.
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('7');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuetext')).toBe('Step 3 of 7');

    expect(screen.getByText(/Step 3 of 7/)).toBeTruthy();
  });

  it('shows the current step title in the compact indicator text', () => {
    render(<StepIndicator currentStep="landlord-rating" />);
    const compactLine = screen.getByText(/Step 5 of 7/);
    expect(compactLine.textContent).toMatch(/Landlord/);

    const bar = screen.getByRole('progressbar', { name: /review progress/i });
    expect(bar.getAttribute('aria-valuenow')).toBe('5');
  });
});
