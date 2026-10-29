import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import AddressStep, { type ManualAddress } from '../../components/reviews/form-steps/AddressStep';
import { STATUS_SETTLE_MS } from '../../components/ui/useComboboxListbox';

// The review form's address search as a WAI-ARIA APG combobox with a listbox popup (A11Y-03).
// Fictional addresses only. fetch is stubbed: Google is never called.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const LABEL = 'Search for your building address';
const MANUAL = /Enter it manually/;
const API_ERROR_SENTENCE =
  'Address search is temporarily unavailable. You can still enter your address manually below.';

const ourBuildings = [
  { id: 'b-ex-1', type: 'building', title: '12 Example Road', subtitle: 'Brighton, Boston, MA', slug: '12-example-road-boston', reviewCount: 2 },
  { id: 'b-ex-2', type: 'building', title: '14 Example Road', subtitle: 'Brighton, Boston, MA', slug: '14-example-road-boston', reviewCount: 0 },
  // The review form shows buildings only; a landlord row is dropped.
  { id: 'l-ex-1', type: 'landlord', title: 'Example Property Group', subtitle: '3 reviews', slug: 'example-property-group', reviewCount: 3 },
];

const googlePredictions = [
  { placeId: 'gp-ex-16', description: '16 Example Road, Brighton, MA, USA', mainText: '16 Example Road', secondaryText: 'Brighton, MA, USA' },
];

interface StubOptions {
  db?: unknown[];
  predictions?: unknown[];
  placesError?: boolean;
}

/** Plain objects rather than Response, so fake timers do not have to drive a body stream. */
function stubFetch({ db = ourBuildings, predictions = googlePredictions, placesError = false }: StubOptions = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/search/autocomplete')) {
      return { ok: true, json: async () => ({ results: db }) };
    }
    if (url.startsWith('/api/places/autocomplete')) {
      if (placesError) return { ok: false, json: async () => ({ error: 'unavailable' }) };
      return { ok: true, json: async () => ({ predictions }) };
    }
    if (url.startsWith('/api/places/details')) {
      return { ok: true, json: async () => ({ place: null }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const baseManualAddress: ManualAddress = { streetAddress: '', city: '', state: 'MA', zipCode: '' };

function renderStep() {
  const handlers = {
    onPlaceSelect: vi.fn(),
    onExistingBuildingSelect: vi.fn(),
    onEnterManual: vi.fn(),
  };
  const view = render(
    <AddressStep
      selectedPlace={null}
      loading={false}
      error={null}
      manualMode={false}
      manualAddress={baseManualAddress}
      onPlaceSelect={handlers.onPlaceSelect}
      onExistingBuildingSelect={handlers.onExistingBuildingSelect}
      onConfirm={vi.fn()}
      onEnterManual={handlers.onEnterManual}
      onManualAddressChange={vi.fn()}
      onManualConfirm={vi.fn()}
      onBackToSearch={vi.fn()}
    />,
  );
  return { ...view, ...handlers };
}

function combobox(): HTMLInputElement {
  return screen.getByRole('combobox', { name: LABEL }) as HTMLInputElement;
}

/** Type, then wait for both sources: our buildings first, then the Google suggestions. */
async function typeAndWaitForBoth(value = '12 Example Road') {
  const input = combobox();
  fireEvent.change(input, { target: { value } });
  await screen.findByText('Existing properties');
  await screen.findByText('16 Example Road', undefined, { timeout: 2000 });
  return input;
}

/**
 * Move fake time on inside act. React runs effects only when an act scope ends, so the settle
 * timer an effect schedules cannot start inside the same advance that delivered the results.
 */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Both fetches answer (the Google debounce is 600ms), then the status region settles. */
async function settleBothSources() {
  await advance(700);
  await advance(STATUS_SETTLE_MS + 100);
}

function statusRegion(container: HTMLElement): HTMLElement {
  const region = container.querySelector('[role="status"]');
  if (!region) throw new Error('no status region');
  return region as HTMLElement;
}

describe('AddressAutocomplete combobox semantics', () => {
  it('is a combobox named by the visible label, collapsed until there are results', () => {
    stubFetch();
    renderStep();
    const input = combobox();
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    // The placeholder stays: the e2e specs and older tests find the input by it.
    expect(input.getAttribute('placeholder')).toBe('Start typing your address...');
    // The help line describes it.
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toContain('Enter the street address of the building');
  });

  it('opens a listbox of grouped options, with the manual-entry option last', async () => {
    stubFetch();
    renderStep();
    const input = await typeAndWaitForBoth();

    expect(input.getAttribute('aria-expanded')).toBe('true');
    const listbox = screen.getByRole('listbox', { name: LABEL });
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);

    const existing = within(listbox).getByRole('group', { name: 'Existing properties' });
    expect(within(existing).getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('12 Example Road'),
      expect.stringContaining('14 Example Road'),
    ]);
    const other = within(listbox).getByRole('group', { name: 'Other addresses' });
    expect(within(other).getAllByRole('option')).toHaveLength(1);

    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(options[options.length - 1].textContent).toMatch(MANUAL);
    expect(listbox.textContent).not.toContain('Landlord');
    expect(listbox.textContent).not.toContain('Example Property Group');
  });

  it('keeps the attribution and the error sentence outside the listbox', async () => {
    stubFetch();
    const { container } = renderStep();
    await typeAndWaitForBoth();
    const listbox = screen.getByRole('listbox');
    expect(listbox.textContent).not.toContain('Powered by Google');
    const attribution = screen.getByText('Powered by Google');
    expect(attribution.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.textContent).toContain('Powered by Google');
  });

  it('ArrowDown activates the first option and ArrowUp from it wraps to the manual option', async () => {
    stubFetch();
    renderStep();
    const input = await typeAndWaitForBoth();
    const options = screen.getAllByRole('option');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].getAttribute('aria-selected')).toBe('false');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const manual = options[options.length - 1];
    expect(input.getAttribute('aria-activedescendant')).toBe(manual.id);
    expect(manual.getAttribute('aria-selected')).toBe('true');
    expect(options[0].getAttribute('aria-selected')).toBe('false');
  });

  it('ArrowDown from the last option wraps to the first', async () => {
    stubFetch();
    renderStep();
    const input = await typeAndWaitForBoth();
    const options = screen.getAllByRole('option');
    for (let i = 0; i < options.length; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[options.length - 1].id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
  });

  it('Enter on an "Existing properties" option hands its building up', async () => {
    stubFetch();
    const { onExistingBuildingSelect } = renderStep();
    const input = await typeAndWaitForBoth();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onExistingBuildingSelect).toHaveBeenCalledWith('b-ex-2');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('Enter on the manual option takes the manual-entry path', async () => {
    stubFetch();
    const { onEnterManual, onExistingBuildingSelect } = renderStep();
    const input = await typeAndWaitForBoth();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEnterManual).toHaveBeenCalledTimes(1);
    expect(onExistingBuildingSelect).not.toHaveBeenCalled();
  });

  it('Enter with no active option selects nothing', async () => {
    stubFetch();
    const { onEnterManual, onExistingBuildingSelect, onPlaceSelect } = renderStep();
    const input = await typeAndWaitForBoth();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEnterManual).not.toHaveBeenCalled();
    expect(onExistingBuildingSelect).not.toHaveBeenCalled();
    expect(onPlaceSelect).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking an option selects it', async () => {
    stubFetch();
    const { onExistingBuildingSelect } = renderStep();
    await typeAndWaitForBoth();
    fireEvent.click(screen.getByRole('option', { name: /12 Example Road/ }));
    expect(onExistingBuildingSelect).toHaveBeenCalledWith('b-ex-1');
  });

  it('a mouse press on an option does not take focus from the input', async () => {
    stubFetch();
    renderStep();
    await typeAndWaitForBoth();
    const option = screen.getByRole('option', { name: /12 Example Road/ });
    const pressed = fireEvent.mouseDown(option);
    // fireEvent returns false when the default was prevented.
    expect(pressed).toBe(false);
  });

  it('Tab closes the popup without selecting', async () => {
    stubFetch();
    const { onExistingBuildingSelect, onPlaceSelect, onEnterManual } = renderStep();
    const input = await typeAndWaitForBoth();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const tab = fireEvent.keyDown(input, { key: 'Tab' });
    expect(tab).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onExistingBuildingSelect).not.toHaveBeenCalled();
    expect(onPlaceSelect).not.toHaveBeenCalled();
    expect(onEnterManual).not.toHaveBeenCalled();
  });

  it('Escape closes the popup, and a second Escape clears the text', async () => {
    stubFetch();
    renderStep();
    const input = await typeAndWaitForBoth();
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.value).toBe('12 Example Road');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear address' })).toBeNull();

    // ArrowDown has nothing to reopen after a clear.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('ArrowDown reopens a popup closed by Escape', async () => {
    stubFetch();
    renderStep();
    const input = await typeAndWaitForBoth();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id);
  });

  it('focus moving to another control closes the popup', async () => {
    stubFetch();
    renderStep();
    const input = await typeAndWaitForBoth();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    fireEvent.blur(input, { relatedTarget: elsewhere });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    elsewhere.remove();
  });

  it('a blur to nowhere, as a phone keyboard Done button does, leaves the list showing', async () => {
    stubFetch();
    renderStep();
    const input = await typeAndWaitForBoth();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.blur(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    // No option stays active, so nothing is chosen by a later Enter.
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('the "Clear address" button clears the text and puts focus back in the input', async () => {
    stubFetch();
    renderStep();
    const input = await typeAndWaitForBoth();
    const clear = screen.getByRole('button', { name: 'Clear address' });
    expect(clear.getAttribute('type')).toBe('button');
    expect(clear.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(clear);
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('no option is tabbable and none holds a button or a link', async () => {
    stubFetch();
    renderStep();
    await typeAndWaitForBoth();
    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.tabIndex).not.toBe(0);
      expect(option.hasAttribute('tabindex')).toBe(false);
      expect(option.querySelector('button, a, input, [tabindex]')).toBeNull();
    }
    // The listbox's own children are only groups and options.
    const listbox = screen.getByRole('listbox');
    for (const child of Array.from(listbox.children)) {
      expect(['group', 'option']).toContain(child.getAttribute('role'));
    }
  });

  it('shows the lookup error sentence outside the listbox and says it in the status region', async () => {
    vi.useFakeTimers();
    stubFetch({ db: [], placesError: true });
    const { container } = renderStep();
    const input = combobox();
    fireEvent.change(input, { target: { value: '16 Example Road' } });
    await settleBothSources();

    // Once in the popup, once in the status region; neither inside the listbox.
    const [shown, said] = screen.getAllByText(API_ERROR_SENTENCE);
    expect(shown.closest('[role="status"]')).toBeNull();
    expect(said.getAttribute('role')).toBe('status');
    expect(shown.closest('[role="listbox"]')).toBeNull();
    expect(screen.getByRole('listbox').textContent).not.toContain('temporarily unavailable');
    // Only the manual-entry option remains.
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringMatching(MANUAL)]);
    expect(statusRegion(container).textContent).toBe(API_ERROR_SENTENCE);
  });
});

describe('AddressAutocomplete status region', () => {
  it('is rendered before any results, polite, and empty', () => {
    stubFetch();
    const { container } = renderStep();
    const region = statusRegion(container);
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.className).toContain('sr-only');
    expect(region.textContent).toBe('');
  });

  it('reads the result count only once both fetches have settled and the settle time has passed', async () => {
    vi.useFakeTimers();
    stubFetch();
    const { container } = renderStep();
    const region = statusRegion(container);
    fireEvent.change(combobox(), { target: { value: '12 Example Road' } });

    // Our buildings are in at 150ms; Google is still to come.
    await advance(300);
    expect(screen.getByText('Existing properties')).toBeTruthy();
    expect(region.textContent).toBe('');

    // Google answers at 600ms. The count waits the settle time after that.
    await advance(400);
    expect(screen.getByText('16 Example Road')).toBeTruthy();
    expect(region.textContent).toBe('');
    await advance(STATUS_SETTLE_MS - 150);
    expect(region.textContent).toBe('');

    await advance(200);
    // Two of our buildings and one Google address; the manual-entry option is not a result.
    expect(screen.getAllByRole('option')).toHaveLength(4);
    expect(region.textContent).toBe('3 results available');
  });

  it('says "No results" for an empty response', async () => {
    vi.useFakeTimers();
    stubFetch({ db: [], predictions: [] });
    const { container } = renderStep();
    fireEvent.change(combobox(), { target: { value: '99 Nowhere Lane' } });
    await settleBothSources();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringMatching(MANUAL)]);
    expect(statusRegion(container).textContent).toBe('No results');
  });

  it('empties when the text is cleared', async () => {
    vi.useFakeTimers();
    stubFetch({ predictions: [] });
    const { container } = renderStep();
    const input = combobox();
    fireEvent.change(input, { target: { value: '12 Example Road' } });
    await settleBothSources();
    expect(statusRegion(container).textContent).toBe('2 results available');

    fireEvent.change(input, { target: { value: '' } });
    await advance(STATUS_SETTLE_MS + 100);
    expect(statusRegion(container).textContent).toBe('');
  });
});

describe('AddressAutocomplete late results and the clear button', () => {
  /** Our-buildings answers at once; the Google lookup waits until the test answers it. */
  function stubFetchHoldingGoogle() {
    const held: { answer: (value: unknown) => void } = { answer: () => {} };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/search/autocomplete')) {
        return Promise.resolve({ ok: true, json: async () => ({ results: ourBuildings }) });
      }
      return new Promise((resolve) => {
        held.answer = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    return held;
  }

  function otherControl(): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = 'Elsewhere';
    document.body.appendChild(button);
    return button;
  }

  it('new results clear the active option, so Enter cannot take a row that moved under the reader', async () => {
    vi.useFakeTimers();
    stubFetch();
    const { onEnterManual, onExistingBuildingSelect, onPlaceSelect } = renderStep();
    const input = combobox();
    input.focus();
    fireEvent.change(input, { target: { value: '12 Example Road' } });
    // Our buildings are in; the reader goes to the last option, manual entry.
    await advance(300);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const active = document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
    expect(active?.textContent).toMatch(MANUAL);

    // The Google address lands where manual entry was.
    await advance(400);
    expect(screen.getByText('16 Example Road')).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEnterManual).not.toHaveBeenCalled();
    expect(onExistingBuildingSelect).not.toHaveBeenCalled();
    expect(onPlaceSelect).not.toHaveBeenCalled();
  });

  it('results that arrive after focus has moved to another control do not open the popup', async () => {
    vi.useFakeTimers();
    stubFetch();
    const { container } = renderStep();
    const input = combobox();
    input.focus();
    fireEvent.change(input, { target: { value: '12 Example Road' } });
    const elsewhere = otherControl();
    elsewhere.focus();

    await settleBothSources();
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(statusRegion(container).textContent).toBe('');

    // Back in the box, the results it now holds open as usual.
    input.focus();
    fireEvent.focus(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    elsewhere.remove();
  });

  it('a Google lookup that starts while Clear address has focus leaves the button in place', async () => {
    vi.useFakeTimers();
    const held = stubFetchHoldingGoogle();
    renderStep();
    const input = combobox();
    input.focus();
    fireEvent.change(input, { target: { value: '12 Example Road' } });
    await advance(200);

    // The reader tabs from the input to Clear address before the Google lookup starts.
    const clear = screen.getByRole('button', { name: 'Clear address' });
    clear.focus();
    await advance(500);
    expect(document.activeElement).toBe(clear);
    expect(clear.isConnected).toBe(true);

    await act(async () => {
      held.answer({ ok: true, json: async () => ({ predictions: googlePredictions }) });
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear address' }));
  });

  it('a response for text that has since been cleared is dropped', async () => {
    vi.useFakeTimers();
    const held = stubFetchHoldingGoogle();
    renderStep();
    const input = combobox();
    input.focus();
    fireEvent.change(input, { target: { value: '12 Example Road' } });
    // Google is asked at 600ms and has not answered when the reader clears the box.
    await advance(700);
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');

    await act(async () => {
      held.answer({ ok: true, json: async () => ({ predictions: googlePredictions }) });
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByText('16 Example Road')).toBeNull();
  });
});
