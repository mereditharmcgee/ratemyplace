import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/react';
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

  // From lg up the steps are an ordered list. Each title sits under its circle, so the row
  // fits the 704px form column instead of running 87 to 215px past it at 1024 to 1440.
  it('lists every step in order from lg up, and marks the current one', () => {
    render(<StepIndicator currentStep="unit-rating" />);

    const list = screen.getByRole('list', { name: 'Review progress' });
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(7);
    expect(items.map((li) => li.textContent)).toEqual([
      '1Address',
      '2Unit Details',
      '3Your Unit',
      '4Building',
      '5Landlord',
      '6Additional',
      '7Submit',
    ]);

    const current = items.filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(items.indexOf(current[0])).toBe(2);
    expect(current[0].textContent).toContain('Your Unit');
  });

  it('keeps the circles and connectors as they look today, with the connectors hidden', () => {
    render(<StepIndicator currentStep="building-rating" />);
    const list = screen.getByRole('list', { name: 'Review progress' });
    const items = within(list).getAllByRole('listitem');

    // Done and current steps are filled; the rest are gray.
    const circles = items.map((li) => li.firstElementChild as HTMLElement);
    expect(circles.map((c) => c.className.includes('bg-teal-700'))).toEqual([true, true, true, true, false, false, false]);

    // One connector between each pair of steps, decorative only, colored up to the current step.
    const connectors = Array.from(list.querySelectorAll('li > span[aria-hidden="true"]'));
    expect(connectors).toHaveLength(6);
    expect(connectors.map((c) => c.className.includes('bg-teal-600'))).toEqual([true, true, true, false, false, false]);

    // No hover tooltips repeating the visible titles, and titles may wrap.
    expect(list.querySelectorAll('[title]')).toHaveLength(0);
    expect(list.innerHTML).not.toContain('whitespace-nowrap');
  });
});
