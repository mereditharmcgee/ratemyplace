import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import AddressStep, { type ManualAddress } from '../../components/reviews/form-steps/AddressStep';

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
