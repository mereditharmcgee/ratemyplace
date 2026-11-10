import { describe, expect, it } from 'vitest';
import {
  clampActive,
  comboboxKeyAction,
  comboboxStatusText,
  type ComboboxKeyState,
} from '../combobox';

// The keyboard rules shared by both address searches (WAI-ARIA APG combobox with a listbox
// popup, list autocomplete without automatic selection). The hook in
// src/components/ui/useComboboxListbox.ts only carries these actions out.

function state(overrides: Partial<ComboboxKeyState> = {}): ComboboxKeyState {
  return { open: true, activeIndex: -1, count: 3, hasText: true, ...overrides };
}

describe('comboboxKeyAction: ArrowDown', () => {
  it('opens a closed popup on the first option', () => {
    expect(comboboxKeyAction('ArrowDown', state({ open: false }))).toEqual({ type: 'open-first' });
  });

  it('moves to the first option when the popup is open and nothing is active', () => {
    expect(comboboxKeyAction('ArrowDown', state({ activeIndex: -1 }))).toEqual({ type: 'move', index: 0 });
  });

  it('moves to the next option', () => {
    expect(comboboxKeyAction('ArrowDown', state({ activeIndex: 0 }))).toEqual({ type: 'move', index: 1 });
  });

  it('wraps from the last option to the first', () => {
    expect(comboboxKeyAction('ArrowDown', state({ activeIndex: 2 }))).toEqual({ type: 'move', index: 0 });
  });

  it('does nothing when there are no options, open or closed', () => {
    expect(comboboxKeyAction('ArrowDown', state({ count: 0 }))).toEqual({ type: 'none' });
    expect(comboboxKeyAction('ArrowDown', state({ open: false, count: 0 }))).toEqual({ type: 'none' });
  });

  it('with Alt, opens a closed popup without moving', () => {
    expect(comboboxKeyAction('ArrowDown', state({ open: false }), { altKey: true })).toEqual({ type: 'open-only' });
  });

  it('with Alt, leaves an open popup and its active option alone', () => {
    expect(comboboxKeyAction('ArrowDown', state({ activeIndex: 1 }), { altKey: true })).toEqual({ type: 'none' });
  });
});

describe('comboboxKeyAction: ArrowUp', () => {
  it('opens a closed popup on the last option', () => {
    expect(comboboxKeyAction('ArrowUp', state({ open: false }))).toEqual({ type: 'open-last' });
  });

  it('moves to the last option when the popup is open and nothing is active', () => {
    expect(comboboxKeyAction('ArrowUp', state({ activeIndex: -1 }))).toEqual({ type: 'move', index: 2 });
  });

  it('moves to the previous option', () => {
    expect(comboboxKeyAction('ArrowUp', state({ activeIndex: 2 }))).toEqual({ type: 'move', index: 1 });
  });

  it('wraps from the first option to the last', () => {
    expect(comboboxKeyAction('ArrowUp', state({ activeIndex: 0 }))).toEqual({ type: 'move', index: 2 });
  });

  it('does nothing when there are no options', () => {
    expect(comboboxKeyAction('ArrowUp', state({ count: 0 }))).toEqual({ type: 'none' });
  });

  it('with Alt, closes an open popup and does nothing on a closed one', () => {
    expect(comboboxKeyAction('ArrowUp', state({ activeIndex: 1 }), { altKey: true })).toEqual({ type: 'close' });
    expect(comboboxKeyAction('ArrowUp', state({ open: false }), { altKey: true })).toEqual({ type: 'none' });
  });
});

describe('comboboxKeyAction: Enter', () => {
  it('selects the active option', () => {
    expect(comboboxKeyAction('Enter', state({ activeIndex: 1 }))).toEqual({ type: 'select', index: 1 });
  });

  it('does nothing without an active option, so a surrounding form still submits', () => {
    expect(comboboxKeyAction('Enter', state({ activeIndex: -1 }))).toEqual({ type: 'none' });
  });

  it('does nothing on a closed popup, even with an index left over', () => {
    expect(comboboxKeyAction('Enter', state({ open: false, activeIndex: 1 }))).toEqual({ type: 'none' });
  });

  it('does nothing when the index is out of range', () => {
    expect(comboboxKeyAction('Enter', state({ activeIndex: 3 }))).toEqual({ type: 'none' });
  });
});

describe('comboboxKeyAction: Escape', () => {
  it('closes an open popup', () => {
    expect(comboboxKeyAction('Escape', state({ activeIndex: 1 }))).toEqual({ type: 'close' });
  });

  it('closes an open popup that holds only a message and no options', () => {
    expect(comboboxKeyAction('Escape', state({ count: 0 }))).toEqual({ type: 'close' });
  });

  it('clears the text when the popup is already closed', () => {
    expect(comboboxKeyAction('Escape', state({ open: false }))).toEqual({ type: 'clear' });
  });

  it('does nothing when the popup is closed and the input is empty', () => {
    expect(comboboxKeyAction('Escape', state({ open: false, hasText: false }))).toEqual({ type: 'none' });
  });
});

describe('comboboxKeyAction: Tab and the keys left to the input', () => {
  it('Tab closes an open popup without selecting', () => {
    expect(comboboxKeyAction('Tab', state({ activeIndex: 1 }))).toEqual({ type: 'close' });
  });

  it('Tab on a closed popup does nothing', () => {
    expect(comboboxKeyAction('Tab', state({ open: false }))).toEqual({ type: 'none' });
  });

  it.each(['ArrowLeft', 'ArrowRight', 'Home', 'End'])(
    '%s with an option active hands focus back to the text (the caret still moves)',
    (key) => {
      expect(comboboxKeyAction(key, state({ activeIndex: 1 }))).toEqual({ type: 'deactivate' });
    },
  );

  it.each(['ArrowLeft', 'ArrowRight', 'Home', 'End'])('%s with no option active is left to the input', (key) => {
    expect(comboboxKeyAction(key, state({ activeIndex: -1 }))).toEqual({ type: 'none' });
    expect(comboboxKeyAction(key, state({ open: false, activeIndex: 1 }))).toEqual({ type: 'none' });
  });

  it('ignores ordinary typing', () => {
    expect(comboboxKeyAction('a', state())).toEqual({ type: 'none' });
    expect(comboboxKeyAction('a', state({ activeIndex: 1 }))).toEqual({ type: 'none' });
  });
});

describe('clampActive', () => {
  it('is -1 when there are no options', () => {
    expect(clampActive(0, 0)).toBe(-1);
    expect(clampActive(4, 0)).toBe(-1);
    expect(clampActive(-1, 0)).toBe(-1);
  });

  it('keeps an index that still fits', () => {
    expect(clampActive(1, 3)).toBe(1);
    expect(clampActive(-1, 3)).toBe(-1);
  });

  it('moves an index past the end onto the last option', () => {
    expect(clampActive(5, 3)).toBe(2);
  });
});

describe('comboboxStatusText', () => {
  it('says when there is nothing', () => {
    expect(comboboxStatusText(0)).toBe('No results');
  });

  it('uses the singular for one result', () => {
    expect(comboboxStatusText(1)).toBe('1 result available');
  });

  it('counts several results', () => {
    expect(comboboxStatusText(4)).toBe('4 results available');
  });
});
