import AddressAutocomplete, { type PlaceDetails } from '../../AddressAutocomplete';
import type { PlaceData } from './types';

export interface ManualAddress {
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
}

interface Props {
  selectedPlace: PlaceData | null;
  loading: boolean;
  error: string | null;
  manualMode: boolean;
  manualAddress: ManualAddress;
  onPlaceSelect: (place: PlaceDetails) => void;
  onConfirm: () => void;
  onEnterManual: () => void;
  onManualAddressChange: (addr: ManualAddress) => void;
  onManualConfirm: () => void;
  onBackToSearch: () => void;
}

export default function AddressStep({
  selectedPlace,
  loading,
  error,
  manualMode,
  manualAddress,
  onPlaceSelect,
  onConfirm,
  onEnterManual,
  onManualAddressChange,
  onManualConfirm,
  onBackToSearch,
}: Props) {
  if (manualMode) {
    return (
      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Enter your building address
            </label>
            <button
              type="button"
              onClick={onBackToSearch}
              className="text-sm text-teal-700 hover:text-teal-800 underline"
            >
              Back to search
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Street address</label>
              <input
                type="text"
                value={manualAddress.streetAddress}
                onChange={(e) => onManualAddressChange({ ...manualAddress, streetAddress: e.target.value })}
                placeholder="e.g. 100 Beacon St"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">City</label>
                <input
                  type="text"
                  value={manualAddress.city}
                  onChange={(e) => onManualAddressChange({ ...manualAddress, city: e.target.value })}
                  placeholder="e.g. Boston"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">State</label>
                <input
                  type="text"
                  value={manualAddress.state}
                  onChange={(e) => onManualAddressChange({ ...manualAddress, state: e.target.value.toUpperCase().slice(0, 2) })}
                  placeholder="MA"
                  maxLength={2}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Zip code (optional)</label>
              <input
                type="text"
                value={manualAddress.zipCode}
                onChange={(e) => onManualAddressChange({ ...manualAddress, zipCode: e.target.value })}
                placeholder="02116"
                maxLength={10}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-3">
            Address is entered manually and is not verified against an address database.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-[6px] p-4 text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onManualConfirm}
            disabled={loading || !manualAddress.streetAddress.trim() || !manualAddress.city.trim()}
            className="px-6 py-2 bg-teal-700 text-white font-semibold rounded-[4px] hover:bg-teal-800 disabled:opacity-50"
          >
            {loading ? 'Adding...' : 'Continue'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Search for your building address
        </label>
        <AddressAutocomplete
          onPlaceSelect={onPlaceSelect}
          onManualEntry={onEnterManual}
          placeholder="Start typing your address..."
        />
        <p className="text-sm text-gray-500 mt-2">
          Enter the street address of the building you want to review
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-[6px] p-4 text-red-700">
          {error}
        </div>
      )}

      {selectedPlace && (
        <div className="space-y-4">
          <div className="bg-teal-50 border border-teal-200 rounded-[6px] p-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="font-semibold text-teal-900">{selectedPlace.streetAddress}</div>
                <div className="text-sm text-teal-700">
                  {selectedPlace.neighborhood && `${selectedPlace.neighborhood}, `}
                  {selectedPlace.city}, {selectedPlace.state} {selectedPlace.zipCode}
                </div>
                {selectedPlace.existingBuilding ? (
                  <div className="mt-2 text-sm text-teal-700">
                    This building is already in our system
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-teal-700">
                    This will be a new building in our system
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="px-6 py-2 bg-teal-700 text-white font-semibold rounded-[4px] hover:bg-teal-800 disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Continue'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
