import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { HTMLAttributes, InputHTMLAttributes, KeyboardEvent, MouseEvent } from 'react';
import { clampActive, comboboxKeyAction, comboboxStatusText } from '../../lib/combobox';

// One combobox with a listbox popup (WAI-ARIA APG, list autocomplete without automatic
// selection), shared by AddressAutocomplete and HomeSearch. The keyboard rules and the status
// wording are pure and tested in src/lib/combobox.ts; this hook wires them to React.
//
// Focus never leaves the input: the active option is announced through aria-activedescendant,
// options are not tabbable, and a mouse press on an option is kept from moving focus.

/**
 * How long results must sit still before the status region speaks. Long enough for the 150ms
 * database fetch and the 600ms Google debounce to settle first, so one count is read, not three.
 */
export const STATUS_SETTLE_MS = 700;

export interface ComboboxStatusOptions {
  /** The reader has typed and asked for results. When false the region is empty. */
  active: boolean;
  /** How many results to report. Action-only options (manual entry, write a review) are not results. */
  results: number;
  /** A fetch is in flight. The region waits for it. */
  loading: boolean;
  /** Said instead of the count, such as the lookup error sentence. */
  message?: string | null;
  /**
   * Any value whose identity changes when a results update lands, and only then (memoize it).
   * It restarts the settle timer.
   */
  version: unknown;
}

export interface UseComboboxListboxOptions {
  /** How many options the listbox holds, in keyboard order. */
  count: number;
  /** The popup is shown. It may hold only a message and no options. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An option was chosen by Enter or a click. */
  onSelect: (index: number) => void;
  /** Escape on a closed popup with text in the input. */
  onClear: () => void;
  hasText: boolean;
  /** The listbox's name: an element id, or a string when there is no visible label. */
  listboxLabelledBy?: string;
  listboxLabel?: string;
  status: ComboboxStatusOptions;
}

export type ComboboxInputProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  | 'role'
  | 'aria-autocomplete'
  | 'aria-expanded'
  | 'aria-controls'
  | 'aria-activedescendant'
  | 'onKeyDown'
  | 'onBlur'
>;

export type ComboboxOptionProps = Pick<
  HTMLAttributes<HTMLElement>,
  'role' | 'aria-selected' | 'onMouseDown' | 'onMouseEnter' | 'onClick'
> & { id: string };

export interface ComboboxListbox {
  inputProps: ComboboxInputProps;
  listboxProps: Pick<HTMLAttributes<HTMLElement>, 'role' | 'aria-labelledby' | 'aria-label'> & { id: string };
  getOptionProps: (index: number) => ComboboxOptionProps;
  /** The id an option at this index carries. */
  optionId: (index: number) => string;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** The popup is shown and holds at least one option. */
  expanded: boolean;
  /** Text for an always-rendered polite status region outside the popup. */
  statusText: string;
}

/** A mouse press inside the popup must not take focus from the input. */
export function keepInputFocus(event: MouseEvent): void {
  event.preventDefault();
}

export function useComboboxListbox(options: UseComboboxListboxOptions): ComboboxListbox {
  const { count, open, onOpenChange, onSelect, onClear, hasText, listboxLabelledBy, listboxLabel, status } = options;
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [statusText, setStatusText] = useState('');
  // Only a keyboard move scrolls the list; a hovered option is already where the pointer is.
  const scrollPending = useRef(false);

  const expanded = open && count > 0;
  const optionId = useCallback((index: number) => `${listboxId}-option-${index}`, [listboxId]);

  // Results came and went: keep the active option inside the list.
  useEffect(() => {
    setActiveIndex((current) => clampActive(current, count));
  }, [count]);

  useEffect(() => {
    if (!scrollPending.current) return;
    scrollPending.current = false;
    if (!expanded || activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, expanded, optionId]);

  // The status region speaks once results have stopped changing and nothing is loading. It is
  // emptied first, so the same count after new typing is read again.
  const { active: statusActive, results: statusResults, loading: statusLoading, message: statusMessage, version } = status;
  useEffect(() => {
    setStatusText('');
    if (!statusActive || statusLoading) return;
    const timer = setTimeout(() => {
      setStatusText(statusMessage ? statusMessage : comboboxStatusText(statusResults));
    }, STATUS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [statusActive, statusLoading, statusResults, statusMessage, version]);

  const moveTo = (index: number) => {
    scrollPending.current = true;
    setActiveIndex(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const action = comboboxKeyAction(event.key, { open, activeIndex, count, hasText }, { altKey: event.altKey });
    switch (action.type) {
      case 'open-first':
        event.preventDefault();
        onOpenChange(true);
        moveTo(0);
        break;
      case 'open-last':
        event.preventDefault();
        onOpenChange(true);
        moveTo(count - 1);
        break;
      case 'open-only':
        event.preventDefault();
        onOpenChange(true);
        break;
      case 'move':
        event.preventDefault();
        moveTo(action.index);
        break;
      case 'select':
        event.preventDefault();
        setActiveIndex(-1);
        onSelect(action.index);
        break;
      case 'close':
        // Tab still moves focus on; only the popup goes.
        if (event.key !== 'Tab') event.preventDefault();
        setActiveIndex(-1);
        onOpenChange(false);
        break;
      case 'clear':
        event.preventDefault();
        setActiveIndex(-1);
        onClear();
        break;
      case 'none':
        break;
    }
  };

  const onBlur = () => {
    setActiveIndex(-1);
    onOpenChange(false);
  };

  const getOptionProps = (index: number): ComboboxOptionProps => ({
    role: 'option',
    id: optionId(index),
    'aria-selected': index === activeIndex,
    onMouseDown: keepInputFocus,
    onMouseEnter: () => setActiveIndex(index),
    onClick: () => {
      setActiveIndex(-1);
      onSelect(index);
    },
  });

  return {
    inputProps: {
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': expanded,
      'aria-controls': listboxId,
      'aria-activedescendant': expanded && activeIndex >= 0 && activeIndex < count ? optionId(activeIndex) : undefined,
      onKeyDown,
      onBlur,
    },
    listboxProps: {
      role: 'listbox',
      id: listboxId,
      'aria-labelledby': listboxLabelledBy,
      'aria-label': listboxLabelledBy ? undefined : listboxLabel,
    },
    getOptionProps,
    optionId,
    activeIndex,
    setActiveIndex,
    expanded,
    statusText,
  };
}
