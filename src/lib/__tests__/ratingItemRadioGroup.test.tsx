import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import RatingItem, { RatingScale } from '../../components/reviews/form-steps/RatingItem';
import { getSurveyItemByKey, type SurveyItem } from '../surveyItems';

// A11Y-04: every rating question is a native radio group named by its dimension and statement
// and described by the scale above it. The pills look as they did; only the element under
// them changed. Survey wording, values, order and N/A behavior come from surveyItems.ts as
// before.

afterEach(() => {
  cleanup();
});

function surveyItem(key: string): SurveyItem {
  const found = getSurveyItemByKey(key);
  if (!found) throw new Error(`no survey item ${key}`);
  return found;
}

const REQUIRED_NO_NA = surveyItem('unit_structural');
const OPTIONAL_WITH_NA = surveyItem('building_laundry');

function renderItem(item: SurveyItem, value: number | null | undefined) {
  const onChange = vi.fn();
  render(
    <div>
      <RatingScale id="rating-scale" />
      <RatingItem item={item} value={value} onChange={onChange} describedBy="rating-scale" />
    </div>,
  );
  return { onChange, group: screen.getByRole('radiogroup') };
}

function checkedNames(group: HTMLElement): string[] {
  return within(group)
    .getAllByRole('radio')
    .filter((radio) => (radio as HTMLInputElement).checked)
    .map((radio) => radio.closest('label')?.textContent ?? '');
}

/** The visible pill for an answer: the span after its visually hidden radio. */
function pill(group: HTMLElement, label: string): HTMLElement {
  return within(group).getByRole('radio', { name: label }).nextElementSibling as HTMLElement;
}

describe('RatingItem as a radio group', () => {
  it('is named by the dimension and the statement, and described by the scale', () => {
    const { group } = renderItem(REQUIRED_NO_NA, undefined);
    expect(
      screen.getByRole('radiogroup', {
        name: (name) => name.includes(REQUIRED_NO_NA.dimension) && name.includes(REQUIRED_NO_NA.text),
      }),
    ).toBe(group);
    expect(screen.getByRole('radiogroup', { description: /1 = Strongly Disagree/ })).toBe(group);
  });

  it('offers 1 to 5, and N/A only on an item that allows it', () => {
    const { group } = renderItem(REQUIRED_NO_NA, undefined);
    expect(within(group).getAllByRole('radio')).toHaveLength(5);
    for (const label of ['1', '2', '3', '4', '5']) {
      expect(within(group).getByRole('radio', { name: label })).toBeTruthy();
    }
    expect(within(group).queryByRole('radio', { name: 'N/A' })).toBeNull();
    cleanup();

    const withNA = renderItem(OPTIONAL_WITH_NA, undefined).group;
    expect(within(withNA).getAllByRole('radio')).toHaveLength(6);
    expect(within(withNA).getByRole('radio', { name: 'N/A' })).toBeTruthy();
  });

  it('checks nothing when unanswered, N/A when null, and the answer when a number', () => {
    expect(checkedNames(renderItem(OPTIONAL_WITH_NA, undefined).group)).toEqual([]);
    cleanup();
    expect(checkedNames(renderItem(OPTIONAL_WITH_NA, null).group)).toEqual(['N/A']);
    cleanup();
    expect(checkedNames(renderItem(OPTIONAL_WITH_NA, 3).group)).toEqual(['3']);
    cleanup();
    // The edit form holds an unanswered item as null; with no N/A there is nothing to check.
    expect(checkedNames(renderItem(REQUIRED_NO_NA, null).group)).toEqual([]);
  });

  it('reports a number, or null for N/A, through the same onChange as before', () => {
    const { group, onChange } = renderItem(OPTIONAL_WITH_NA, undefined);
    fireEvent.click(within(group).getByRole('radio', { name: '4' }));
    expect(onChange).toHaveBeenLastCalledWith('building_laundry', 4);
    fireEvent.click(within(group).getByRole('radio', { name: 'N/A' }));
    expect(onChange).toHaveBeenLastCalledWith('building_laundry', null);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('gives every answer in a question the same name, so arrow keys move within it', () => {
    const { group } = renderItem(OPTIONAL_WITH_NA, undefined);
    const names = within(group).getAllByRole('radio').map((radio) => radio.getAttribute('name'));
    expect(new Set(names)).toEqual(new Set(['rating-building_laundry']));
    expect(within(group).getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      'na',
    ]);
  });

  it('keeps the help button out of the group and hides the required star from assistive technology', () => {
    const { group } = renderItem(REQUIRED_NO_NA, undefined);
    const help = screen.getByRole('button', { name: `Help for ${REQUIRED_NO_NA.dimension}` });
    expect(group.contains(help)).toBe(false);
    expect(screen.getByText('*').getAttribute('aria-hidden')).toBe('true');
    expect(within(group).queryByRole('button')).toBeNull();
  });

  it('marks no star on an item that is not required', () => {
    renderItem(OPTIONAL_WITH_NA, undefined);
    expect(screen.queryByText('*')).toBeNull();
  });

  it.each([
    [1, 'bg-red-600 text-white'],
    [2, 'bg-red-600 text-white'],
    [3, 'bg-amber-400 text-slate-900'],
    [4, 'bg-emerald-700 text-white'],
    [5, 'bg-emerald-700 text-white'],
  ])('colors a chosen %i as before', (value, classes) => {
    const { group } = renderItem(OPTIONAL_WITH_NA, value);
    const chosen = pill(group, String(value));
    for (const cls of classes.split(' ')) expect(chosen.classList.contains(cls)).toBe(true);
    for (const cls of ['w-10', 'h-10', 'rounded-full', 'text-sm', 'font-medium']) {
      expect(chosen.classList.contains(cls)).toBe(true);
    }
    const other = pill(group, value === 1 ? '2' : '1');
    expect(other.classList.contains('bg-gray-100')).toBe(true);
    expect(other.classList.contains('bg-red-600')).toBe(false);
  });

  it('colors a chosen N/A gray as before', () => {
    const { group } = renderItem(OPTIONAL_WITH_NA, null);
    const na = pill(group, 'N/A');
    expect(na.classList.contains('bg-gray-500')).toBe(true);
    expect(na.classList.contains('px-3')).toBe(true);
    expect(na.textContent).toBe('N/A');
  });

  it('hides the radio visually and shows keyboard focus on the pill', () => {
    const { group } = renderItem(REQUIRED_NO_NA, undefined);
    const radio = within(group).getByRole('radio', { name: '1' });
    expect(radio.classList.contains('sr-only')).toBe(true);
    expect(radio.classList.contains('peer')).toBe(true);
    expect(radio.hasAttribute('required')).toBe(false);
    expect(radio.hasAttribute('aria-required')).toBe(false);
    const span = pill(group, '1');
    for (const cls of ['peer-focus-visible:outline-2', 'peer-focus-visible:outline-teal-700', 'motion-reduce:transition-none']) {
      expect(span.classList.contains(cls)).toBe(true);
    }
  });
});
