import AddressAutocomplete, { type PlaceDetails } from '../../AddressAutocomplete';
import type { PlaceData } from './types';

interface Props {
  selectedPlace: PlaceData | null;
  loading: boolean;
  error: string | null;
  onPlaceSelect: (place: PlaceDetails) => void;
  onConfirm: () => void;
}

export default function AddressStep({ selectedPlace, loading, error, onPlaceSelect, onConfirm }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Search for your building address
        </label>
        <AddressAutocomplete
          onPlaceSelect={onPlaceSelect}
          placeholder="Start typing your address..."
        />
        <p className="text-sm text-gray-500 mt-2">
          Enter the street address of the building you want to review
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {selectedPlace && (
        <div className="space-y-4">
          <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                  <div className="mt-2 text-sm text-teal-600">
                    This building is already in our system
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-teal-600">
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
              className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Continue'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
