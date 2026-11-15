import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useComboboxListbox } from '../../components/ui/useComboboxListbox';

// The shared combobox hook drops the active option when new results land (the rows may have
// shifted under it). That reset has to belong to the render that shows the new rows. Done in
// an effect, it ran after those rows were on screen, so for one commit aria-activedescendant
// named whatever row now sat at the old index, and an arrow pressed in that window was undone
// when the effect caught up. homeSearch.test.tsx failed intermittently on exactly that.

afterEach(() => {
  cleanup();
});

interface ArrivalProbe {
  /** aria-activedescendant in the commit that put the new rows on screen. */
  activeOnArrival?: string | null;
}

function Harness({ results, pressOnArrival, probe }: { results: string[]; pressOnArrival?: string; probe?: ArrivalProbe }) {
  const version = useMemo(() => ({ results }), [results]);
  const inputRef = useRef<HTMLInputElement>(null);
  const combobox = useComboboxListbox({
    count: results.length,
    open: true,
    onOpenChange: () => {},
    onSelect: () => {},
    onClear: () => {},
    hasText: true,
    listboxLabel: 'Results',
    status: { active: false, results: results.length, loading: false, version },
  });

  // A layout effect runs once the new rows are in the DOM and before React runs that render's
  // effects: the window a reader's key press can land in.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input || !probe) return;
    probe.activeOnArrival = input.getAttribute('aria-activedescendant');
    if (pressOnArrival) input.dispatchEvent(new KeyboardEvent('keydown', { key: pressOnArrival, bubbles: true }));
  }, [version, pressOnArrival, probe]);

  return (
    <div>
      <input ref={inputRef} aria-label="Search" {...combobox.inputProps} />
      <div {...combobox.listboxProps}>
        {results.map((result, index) => (
          <div key={result} {...combobox.getOptionProps(index)}>
            {result}
          </div>
        ))}
      </div>
    </div>
  );
}

describe('useComboboxListbox when new results land', () => {
  it('no commit points the input at a row the reader never arrowed to', () => {
    const first = ['12 Example Road', '14 Example Road', '16 Example Road'];
    const { rerender } = render(<Harness results={first} />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: '14 Example Road' }).id);

    // A late answer puts another row at index 1.
    const probe: ArrivalProbe = {};
    rerender(<Harness results={['99 Example Road', '20 Sample Street', '12 Example Road']} probe={probe} />);
    expect(probe.activeOnArrival).toBeNull();
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(screen.getAllByRole('option').filter((option) => option.getAttribute('aria-selected') === 'true')).toHaveLength(0);
  });

  it('an arrow pressed the moment the rows land is kept', () => {
    const { rerender } = render(<Harness results={['12 Example Road']} />);
    const input = screen.getByRole('combobox');

    rerender(<Harness results={['12 Example Road', '99 Example Road']} pressOnArrival="ArrowDown" probe={{}} />);
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: '12 Example Road' }).id);
  });
});
