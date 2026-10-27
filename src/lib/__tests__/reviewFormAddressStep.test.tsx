import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import AddressStep, { type ManualAddress } from '../../components/reviews/form-steps/AddressStep';
import ReviewForm from '../../components/reviews/ReviewForm';

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
