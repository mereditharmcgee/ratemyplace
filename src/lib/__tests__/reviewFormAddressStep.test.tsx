import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import AddressStep, { type ManualAddress } from '../../components/reviews/form-steps/AddressStep';
import ReviewForm from '../../components/reviews/ReviewForm';
import { browserNav } from '../reviewPaths';

afterEach(() => {
  cleanup();
});

const baseManualAddress: ManualAddress = {
  streetAddress: '',
  city: '',
  state: 'MA',
  zipCode: '',
};

function renderManualStep(overrides: Partial<ManualAddress> = {}) {
  render(
    <AddressStep
      selectedPlace={null}
      loading={false}
      error={null}
      manualMode
      manualAddress={{ ...baseManualAddress, ...overrides }}
      onPlaceSelect={vi.fn()}
      onConfirm={vi.fn()}
      onEnterManual={vi.fn()}
      onManualAddressChange={vi.fn()}
      onManualConfirm={vi.fn()}
      onBackToSearch={vi.fn()}
      onExistingBuildingSelect={vi.fn()}
    />
  );
}

describe('AddressStep manual-entry labeling', () => {
  it('associates every manual-entry field with its label for getByLabelText lookups', () => {
    renderManualStep();

    expect(screen.getByLabelText('Street address')).toBeTruthy();
    expect(screen.getByLabelText('City')).toBeTruthy();
    expect(screen.getByLabelText('State')).toBeTruthy();
    expect(screen.getByLabelText(/Zip code/)).toBeTruthy();
  });

  it('names the four fields as a group after the visible heading, with no orphan label', () => {
    const { container } = render(
      <AddressStep
        selectedPlace={null}
        loading={false}
        error={null}
        manualMode
        manualAddress={baseManualAddress}
        onPlaceSelect={vi.fn()}
        onConfirm={vi.fn()}
        onEnterManual={vi.fn()}
        onManualAddressChange={vi.fn()}
        onManualConfirm={vi.fn()}
        onBackToSearch={vi.fn()}
        onExistingBuildingSelect={vi.fn()}
      />
    );
    const group = screen.getByRole('group', { name: 'Enter your building address' });
    for (const name of ['Street address', 'City', 'State', /Zip code/]) {
      expect(group.contains(screen.getByLabelText(name))).toBe(true);
    }
    for (const label of Array.from(container.querySelectorAll('label'))) {
      expect(label.getAttribute('for')).toBeTruthy();
    }
  });
});

describe('AddressStep announcements and focus', () => {
  const handlers = () => ({
    onPlaceSelect: vi.fn(),
    onConfirm: vi.fn(),
    onEnterManual: vi.fn(),
    onManualAddressChange: vi.fn(),
    onManualConfirm: vi.fn(),
    onBackToSearch: vi.fn(),
    onExistingBuildingSelect: vi.fn(),
  });

  it('a manual-entry error takes focus, since its Continue was disabled while working', () => {
    const props = handlers();
    const filled = { streetAddress: '12 Example Road', city: 'Boston', state: 'MA', zipCode: '' };
    const { rerender } = render(
      <AddressStep selectedPlace={null} loading error={null} manualMode manualAddress={filled} {...props} />
    );
    expect(document.activeElement).toBe(document.body);

    rerender(
      <AddressStep selectedPlace={null} loading={false} error="Failed to add building" manualMode manualAddress={filled} {...props} />
    );
    const focused = document.activeElement as HTMLElement;
    expect(focused.textContent).toBe('Failed to add building');
    expect(focused.getAttribute('tabindex')).toBe('-1');
    // Focus carries the message; a live role as well would have it read twice.
    expect(focused.getAttribute('role')).toBeNull();
    expect(focused.closest('[role="alert"], [aria-live]')).toBeNull();
  });

  it('a search-mode error is announced from an alert region that was there before it', () => {
    const props = handlers();
    const { container, rerender } = render(
      <AddressStep selectedPlace={null} loading={false} error={null} manualMode={false} manualAddress={baseManualAddress} {...props} />
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toBe('');

    rerender(
      <AddressStep
        selectedPlace={null}
        loading={false}
        error="Failed to verify address. Please try again."
        manualMode={false}
        manualAddress={baseManualAddress}
        {...props}
      />
    );
    expect(container.querySelector('[role="alert"]')).toBe(alert);
    expect(alert?.textContent).toBe('Failed to verify address. Please try again.');
    // The search input keeps focus; nothing moves it.
    expect(document.activeElement).toBe(document.body);
  });

  it('the picked place is announced from a polite region that was there before it', () => {
    const props = handlers();
    const { container, rerender } = render(
      <AddressStep selectedPlace={null} loading={false} error={null} manualMode={false} manualAddress={baseManualAddress} {...props} />
    );
    const region = container.querySelector('[aria-live="polite"]:not([role])');
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe('');

    rerender(
      <AddressStep
        selectedPlace={{
          placeId: 'gp-ex-12',
          streetAddress: '12 Example Road',
          neighborhood: 'Brighton',
          city: 'Boston',
          state: 'MA',
          zipCode: '02135',
          latitude: 42.35,
          longitude: -71.15,
          existingBuilding: null,
        }}
        loading={false}
        error={null}
        manualMode={false}
        manualAddress={baseManualAddress}
        {...props}
      />
    );
    expect(container.querySelector('[aria-live="polite"]:not([role])')).toBe(region);
    expect(region?.textContent).toContain('12 Example Road');
    expect(region?.textContent).toContain('This will be a new building in our system');
    // The Continue button is outside the region, so it is not read out with the place.
    const button = screen.getByRole('button', { name: 'Continue' });
    expect(region?.contains(button)).toBe(false);
  });
});

describe('ReviewForm opened from the homepage handoff with a place to confirm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pre-fills the address step, and Continue creates or finds the building through POST', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/buildings' && init?.method === 'POST') {
        return new Response(JSON.stringify({ building: { id: 'n1', slug: 'x' }, created: true }), { status: 201 });
      }
      return new Response(JSON.stringify({ results: [], predictions: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ReviewForm
        initialPlace={{
          placeId: 'gp-5',
          streetAddress: '5 Oak St',
          neighborhood: 'Dorchester',
          city: 'Boston',
          state: 'MA',
          zipCode: '02124',
          existingBuilding: null,
        }}
      />
    );

    expect((screen.getByPlaceholderText('Start typing your address...') as HTMLInputElement).value).toBe('5 Oak St');
    expect(screen.getByText('This will be a new building in our system')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByLabelText('Bedrooms')).toBeTruthy());
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(post?.[0]).toBe('/api/buildings');
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({ placeId: 'gp-5', streetAddress: '5 Oak St', city: 'Boston' });
  });
});

/** The typeahead's two sources: our own buildings first, then Google. */
function stubAddressSearch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/search/autocomplete')) {
      return new Response(JSON.stringify({
        results: [{
          id: 'seed-1202188000',
          type: 'building',
          title: '86-88 Crawford Street',
          subtitle: 'Dorchester, Boston, MA',
          slug: '86-88-crawford-street-boston',
          reviewCount: 0,
        }],
      }), { status: 200 });
    }
    if (url.startsWith('/api/places/autocomplete')) {
      return new Response(JSON.stringify({ predictions: [] }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderSearchStep(onExistingBuildingSelect: (id: string) => void) {
  render(
    <AddressStep
      selectedPlace={null}
      loading={false}
      error={null}
      manualMode={false}
      manualAddress={baseManualAddress}
      onPlaceSelect={vi.fn()}
      onConfirm={vi.fn()}
      onEnterManual={vi.fn()}
      onManualAddressChange={vi.fn()}
      onManualConfirm={vi.fn()}
      onBackToSearch={vi.fn()}
      onExistingBuildingSelect={onExistingBuildingSelect}
    />
  );
}

async function typeAndWaitForExisting() {
  const input = screen.getByPlaceholderText('Start typing your address...');
  fireEvent.change(input, { target: { value: '86-88 Craw' } });
  await screen.findByText('Existing properties');
  return input;
}

describe('"Existing properties" rows open that building', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clicking a row hands its building id up', async () => {
    stubAddressSearch();
    const onExisting = vi.fn();
    renderSearchStep(onExisting);
    await typeAndWaitForExisting();
    fireEvent.click(screen.getByRole('option', { name: /86-88 Crawford Street/ }));
    expect(onExisting).toHaveBeenCalledWith('seed-1202188000');
  });

  it('ArrowDown then Enter on the highlighted row does the same', async () => {
    stubAddressSearch();
    const onExisting = vi.fn();
    renderSearchStep(onExisting);
    const input = await typeAndWaitForExisting();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onExisting).toHaveBeenCalledWith('seed-1202188000');
  });

  it('in the full form, the click navigates to that building at unit details', async () => {
    stubAddressSearch();
    const go = vi.spyOn(browserNav, 'go').mockImplementation(() => {});
    render(<ReviewForm />);
    await typeAndWaitForExisting();
    fireEvent.click(screen.getByRole('option', { name: /86-88 Crawford Street/ }));
    expect(go).toHaveBeenCalledWith('/review/new?building=seed-1202188000');
  });
});

describe('switching between search and manual entry keeps focus on the form (A11Y-05)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('choosing "Enter it manually" by keyboard focuses the street field, and Back to search focuses the search', async () => {
    stubAddressSearch();
    render(<ReviewForm />);
    const input = await typeAndWaitForExisting();
    input.focus();

    // ArrowUp from a closed list lands on the last option, the way out to manual entry.
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const active = document.getElementById(input.getAttribute('aria-activedescendant') ?? '');
    expect(active?.textContent).toMatch(/Enter it manually/);
    fireEvent.keyDown(input, { key: 'Enter' });

    const street = await screen.findByLabelText('Street address');
    expect(document.activeElement).toBe(street);

    fireEvent.click(screen.getByRole('button', { name: 'Back to search' }));
    const search = await screen.findByRole('combobox', { name: 'Search for your building address' });
    expect(document.activeElement).toBe(search);
  });

  it('moves no focus on the first render of either mode', () => {
    render(
      <AddressStep
        selectedPlace={null}
        loading={false}
        error={null}
        manualMode
        manualAddress={baseManualAddress}
        onPlaceSelect={vi.fn()}
        onConfirm={vi.fn()}
        onEnterManual={vi.fn()}
        onManualAddressChange={vi.fn()}
        onManualConfirm={vi.fn()}
        onBackToSearch={vi.fn()}
        onExistingBuildingSelect={vi.fn()}
      />
    );
    expect(document.activeElement).toBe(document.body);
    cleanup();
    renderSearchStep(vi.fn());
    expect(document.activeElement).toBe(document.body);
  });
});
