// The keyboard rules and status wording shared by both address searches: the review form's
// AddressAutocomplete and the homepage HomeSearch. They follow the WAI-ARIA APG combobox with a
// listbox popup (list autocomplete, no automatic selection). The React side is
// src/components/ui/useComboboxListbox.ts, which carries these actions out.
//
// LEAF MODULE: no runtime imports. Both islands import it, so anything it imported would ship
// to every visitor (`clientLeafModules.test.ts` enforces it).

export interface ComboboxKeyState {
  /** The popup is shown (it may hold only a message, with no options). */
  open: boolean;
  /** The option the keyboard is on, or -1 for none. */
  activeIndex: number;
  /** How many options the listbox holds. */
  count: number;
  /** The input has text in it. */
  hasText: boolean;
}

export interface ComboboxKeyOptions {
  altKey?: boolean;
}

export type ComboboxKeyAction =
  | { type: 'open-first' }
  | { type: 'open-last' }
  | { type: 'open-only' }
  | { type: 'move'; index: number }
  | { type: 'select'; index: number }
  | { type: 'close' }
  | { type: 'clear' }
  | { type: 'deactivate' }
  | { type: 'none' };

const NONE: ComboboxKeyAction = { type: 'none' };

/**
 * What a key press in the combobox input does.
 *
 * - ArrowDown opens a closed popup on the first option, or moves to the next one, wrapping.
 *   With Alt it opens the popup without moving.
 * - ArrowUp opens a closed popup on the last option, or moves to the previous one, wrapping.
 *   With Alt it closes an open popup.
 * - Enter selects the active option. With none active it does nothing, so a form around the
 *   input still submits.
 * - Escape closes an open popup; on a closed one it clears the text.
 * - Tab closes the popup without selecting, and focus moves on as usual.
 * - ArrowLeft, ArrowRight, Home and End move the text caret, as in any text box. With an option
 *   active they also hand visual focus back to the input, so the reader is back in the text and
 *   Enter submits what was typed rather than an option they can no longer hear.
 */
export function comboboxKeyAction(
  key: string,
  state: ComboboxKeyState,
  options: ComboboxKeyOptions = {},
): ComboboxKeyAction {
  const { open, activeIndex, count, hasText } = state;
  const hasActive = open && activeIndex >= 0 && activeIndex < count;

  switch (key) {
    case 'ArrowDown':
      if (count === 0) return NONE;
      if (options.altKey) return open ? NONE : { type: 'open-only' };
      if (!open) return { type: 'open-first' };
      return { type: 'move', index: hasActive ? (activeIndex + 1) % count : 0 };
    case 'ArrowUp':
      if (options.altKey) return open ? { type: 'close' } : NONE;
      if (count === 0) return NONE;
      if (!open) return { type: 'open-last' };
      return { type: 'move', index: hasActive && activeIndex > 0 ? activeIndex - 1 : count - 1 };
    case 'Enter':
      return hasActive ? { type: 'select', index: activeIndex } : NONE;
    case 'Escape':
      if (open) return { type: 'close' };
      return hasText ? { type: 'clear' } : NONE;
    case 'Tab':
      return open ? { type: 'close' } : NONE;
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Home':
    case 'End':
      return hasActive ? { type: 'deactivate' } : NONE;
    default:
      return NONE;
  }
}

/** Keep the active option inside the list when the number of options changes. */
export function clampActive(active: number, count: number): number {
  if (count <= 0) return -1;
  return Math.min(active, count - 1);
}

/** What the status region says once results settle. */
export function comboboxStatusText(count: number): string {
  if (count === 0) return 'No results';
  if (count === 1) return '1 result available';
  return `${count} results available`;
}
