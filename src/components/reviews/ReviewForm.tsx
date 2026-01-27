import { useState } from 'react';
import {
  unitItems,
  buildingItems,
  landlordItems,
  RESPONSE_OPTIONS,
  supplementaryItems,
  type SurveyItem,
} from '../../lib/surveyItems';
import AddressAutocomplete, { type PlaceDetails } from '../AddressAutocomplete';
import { HelpTooltip } from './HelpTooltip';

interface Building {
  id: string;
  address: string;
  neighborhood?: string;
  city: string;
}

interface PlaceData extends PlaceDetails {
  existingBuilding?: Building | null;
}

interface Props {
  building?: Building | null;
}

type Step = 'address' | 'unit-details' | 'unit-rating' | 'building-rating' | 'landlord-rating' | 'additional' | 'confirm';

const bedroomOptions = [
  { value: 'studio', label: 'Studio' },
  { value: '1', label: '1 Bedroom' },
  { value: '2', label: '2 Bedrooms' },
  { value: '3', label: '3 Bedrooms' },
  { value: '4', label: '4 Bedrooms' },
  { value: '5+', label: '5+ Bedrooms' },
];

const bathroomOptions = [
  { value: '1', label: '1 Bathroom' },
  { value: '1.5', label: '1.5 Bathrooms' },
  { value: '2', label: '2 Bathrooms' },
  { value: '2.5', label: '2.5 Bathrooms' },
  { value: '3+', label: '3+ Bathrooms' },
];

const amenityOptions = [
  { id: 'ac', label: 'Air Conditioning' },
  { id: 'in_unit_laundry', label: 'In-Unit Laundry' },
  { id: 'dishwasher', label: 'Dishwasher' },
  { id: 'balcony', label: 'Balcony/Patio' },
  { id: 'storage', label: 'Storage Space' },
  { id: 'pet_friendly', label: 'Pet Friendly' },
  { id: 'doorman', label: 'Doorman/Concierge' },
  { id: 'gym', label: 'Gym/Fitness Center' },
  { id: 'pool', label: 'Pool' },
  { id: 'elevator', label: 'Elevator' },
];

const utilityOptions = [
  { id: 'heat', label: 'Heat' },
  { id: 'hot_water', label: 'Hot Water' },
  { id: 'electricity', label: 'Electricity' },
  { id: 'gas', label: 'Gas' },
  { id: 'water', label: 'Water/Sewer' },
  { id: 'trash', label: 'Trash' },
  { id: 'internet', label: 'Internet' },
];

export default function ReviewForm({ building }: Props) {
  const [step, setStep] = useState<Step>(building ? 'unit-details' : 'address');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(building || null);
  const [selectedPlace, setSelectedPlace] = useState<PlaceData | null>(null);

  // Unit details
  const [unitDetails, setUnitDetails] = useState({
    unitNumber: '',
    bedrooms: '1',
    bathrooms: '1',
    squareFootage: '',
    rentAmount: '',
    amenities: [] as string[],
    utilitiesIncluded: [] as string[],
    laundryType: 'none' as 'in_unit' | 'in_building' | 'coin_op' | 'none',
    laundryCostPerLoad: '',
    estimatedMonthlyUtilities: '',
  });

  // Tenancy info
  const [tenancy, setTenancy] = useState({
    tenure: 18,
    moveOutYear: 'current',
  });

  // Ratings
  const [scores, setScores] = useState<Record<string, number | null>>({});

  // Review
  const [review, setReview] = useState({
    wouldRecommend: 'yes',
    comments: '',
  });

  // Privacy acknowledgment
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);

  // Handle place selection from Google autocomplete
  const handlePlaceSelect = async (place: PlaceDetails) => {
    setLoading(true);
    setError(null);

    try {
      // Check if building already exists in our database
      const response = await fetch(`/api/buildings?placeId=${encodeURIComponent(place.placeId)}`);
      const data = await response.json();

      if (data.building) {
        // Building exists - use it
        setSelectedBuilding({
          id: data.building.id,
          address: data.building.address,
          neighborhood: data.building.neighborhood,
          city: data.building.city,
        });
        setSelectedPlace({ ...place, existingBuilding: data.building });
      } else {
        // New building - store place data for creation during submit
        setSelectedPlace({ ...place, existingBuilding: null });
        setSelectedBuilding(null);
      }
    } catch (err) {
      console.error('Building lookup error:', err);
      setError('Failed to verify address. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Create building if needed and proceed
  const handleAddressConfirm = async () => {
    if (!selectedPlace) return;

    // If building already exists, proceed
    if (selectedBuilding) {
      setStep('unit-details');
      return;
    }

    // Create new building
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/buildings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placeId: selectedPlace.placeId,
          streetAddress: selectedPlace.streetAddress,
          neighborhood: selectedPlace.neighborhood,
          city: selectedPlace.city,
          state: selectedPlace.state,
          zipCode: selectedPlace.zipCode,
          latitude: selectedPlace.latitude,
          longitude: selectedPlace.longitude,
        }),
      });

      const data = await response.json();

      if (response.ok && data.building) {
        setSelectedBuilding({
          id: data.building.id,
          address: selectedPlace.streetAddress,
          neighborhood: selectedPlace.neighborhood,
          city: selectedPlace.city,
        });
        setStep('unit-details');
      } else {
        setError(data.error || 'Failed to add building');
      }
    } catch (err) {
      console.error('Building creation error:', err);
      setError('Failed to add building. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedBuilding) return;

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('building_id', selectedBuilding.id);

      // Unit details
      if (unitDetails.unitNumber) formData.append('unit_number', unitDetails.unitNumber);
      formData.append('bedrooms', unitDetails.bedrooms);
      formData.append('bathrooms', unitDetails.bathrooms);
      if (unitDetails.squareFootage) formData.append('square_footage', unitDetails.squareFootage);
      if (unitDetails.rentAmount) formData.append('rent_amount', unitDetails.rentAmount);
      formData.append('amenities', JSON.stringify(unitDetails.amenities));
      formData.append('utilities_included', JSON.stringify(unitDetails.utilitiesIncluded));

      // Tenancy
      formData.append('tenure_months', tenancy.tenure.toString());
      formData.append('move_out_year', tenancy.moveOutYear);

      // Scores
      for (const [key, value] of Object.entries(scores)) {
        if (value !== null) {
          formData.append(key, value.toString());
        }
      }

      // Review
      formData.append('would_recommend', review.wouldRecommend);
      if (review.comments) formData.append('comments', review.comments);

      const response = await fetch('/api/reviews', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        window.location.href = `/building/${result.buildingSlug}?submitted=true`;
      } else {
        setError(result.error || 'Failed to submit review');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const steps: { id: Step; title: string }[] = [
    { id: 'address', title: 'Address' },
    { id: 'unit-details', title: 'Unit Details' },
    { id: 'unit-rating', title: 'Your Unit' },
    { id: 'building-rating', title: 'Building' },
    { id: 'landlord-rating', title: 'Landlord' },
    { id: 'additional', title: 'Additional' },
    { id: 'confirm', title: 'Submit' },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === step);

  const renderStepIndicator = () => (
    <div className="flex items-center justify-between mb-8 overflow-x-auto">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
              i <= currentStepIndex ? 'bg-teal-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}
          >
            {i + 1}
          </div>
          <span className="hidden sm:block ml-2 text-sm text-gray-600 whitespace-nowrap">{s.title}</span>
          {i < steps.length - 1 && (
            <div className={`w-4 sm:w-12 h-1 mx-2 ${i < currentStepIndex ? 'bg-teal-600' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );

  const renderRatingScale = () => (
    <div className="flex justify-between items-center text-xs text-gray-500 mb-4 px-2">
      <span className="text-coral-600 font-medium">1 = Strongly Disagree</span>
      <span className="text-gray-400">3 = Neutral</span>
      <span className="text-emerald-600 font-medium">5 = Strongly Agree</span>
    </div>
  );

  const renderRatingItem = (item: SurveyItem) => {
    const value = scores[item.key];

    return (
      <div key={item.key} className="py-4 border-b border-gray-100 last:border-0">
        <div className="mb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <span className="text-xs text-gray-400 font-mono mr-2">{item.code}</span>
              <span className="font-medium text-gray-900">{item.dimension}</span>
              {item.required && <span className="text-coral-500 ml-1">*</span>}
              <HelpTooltip help={item.help} dimension={item.dimension} />
            </div>
          </div>
          <p className="text-sm text-gray-600 mt-1">{item.text}</p>
        </div>

        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((rating) => (
            <button
              key={rating}
              type="button"
              onClick={() => setScores({ ...scores, [item.key]: rating })}
              className={`w-10 h-10 rounded-full text-sm font-medium transition-all ${
                value === rating
                  ? rating <= 2
                    ? 'bg-coral-500 text-white'
                    : rating === 3
                      ? 'bg-amber-400 text-slate-900'
                      : 'bg-emerald-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {rating}
            </button>
          ))}
          {item.allowNA && (
            <button
              type="button"
              onClick={() => setScores({ ...scores, [item.key]: null })}
              className={`px-3 h-10 rounded-full text-sm font-medium transition-all ${
                value === null ? 'bg-gray-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              N/A
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderAddressStep = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Search for your building address
        </label>
        <AddressAutocomplete
          onPlaceSelect={handlePlaceSelect}
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
              onClick={handleAddressConfirm}
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

  const renderUnitDetailsStep = () => (
    <div className="space-y-6">
      {selectedBuilding && (
        <div className="bg-slate-50 p-4 rounded-lg mb-6">
          <div className="font-medium">{selectedBuilding.address}</div>
          <div className="text-sm text-gray-500">
            {selectedBuilding.neighborhood && `${selectedBuilding.neighborhood}, `}
            {selectedBuilding.city}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 sm:col-span-1">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Unit Number <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={unitDetails.unitNumber}
            onChange={(e) => setUnitDetails({ ...unitDetails, unitNumber: e.target.value })}
            placeholder="e.g., 2A, 301"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>

        <div className="col-span-2 sm:col-span-1">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Square Footage <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="number"
            value={unitDetails.squareFootage}
            onChange={(e) => setUnitDetails({ ...unitDetails, squareFootage: e.target.value })}
            placeholder="e.g., 750"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Bedrooms</label>
          <select
            value={unitDetails.bedrooms}
            onChange={(e) => setUnitDetails({ ...unitDetails, bedrooms: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            {bedroomOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Bathrooms</label>
          <select
            value={unitDetails.bathrooms}
            onChange={(e) => setUnitDetails({ ...unitDetails, bathrooms: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            {bathroomOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Monthly Rent <span className="text-gray-400">(optional)</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <input
              type="number"
              value={unitDetails.rentAmount}
              onChange={(e) => setUnitDetails({ ...unitDetails, rentAmount: e.target.value })}
              placeholder="e.g., 2500"
              className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Amenities <span className="text-gray-400">(select all that apply)</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {amenityOptions.map((amenity) => (
            <label
              key={amenity.id}
              className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                unitDetails.amenities.includes(amenity.id)
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={unitDetails.amenities.includes(amenity.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setUnitDetails({ ...unitDetails, amenities: [...unitDetails.amenities, amenity.id] });
                  } else {
                    setUnitDetails({
                      ...unitDetails,
                      amenities: unitDetails.amenities.filter((a) => a !== amenity.id),
                    });
                  }
                }}
                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700">{amenity.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Utilities Included in Rent <span className="text-gray-400">(select all that apply)</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {utilityOptions.map((utility) => (
            <label
              key={utility.id}
              className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                unitDetails.utilitiesIncluded.includes(utility.id)
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={unitDetails.utilitiesIncluded.includes(utility.id)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setUnitDetails({
                      ...unitDetails,
                      utilitiesIncluded: [...unitDetails.utilitiesIncluded, utility.id],
                    });
                  } else {
                    setUnitDetails({
                      ...unitDetails,
                      utilitiesIncluded: unitDetails.utilitiesIncluded.filter((u) => u !== utility.id),
                    });
                  }
                }}
                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700">{utility.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Estimated monthly utilities for non-included utilities */}
      {unitDetails.utilitiesIncluded.length < utilityOptions.length && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Estimated Monthly Utility Cost <span className="text-gray-400">(for utilities not included)</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <input
              type="number"
              value={unitDetails.estimatedMonthlyUtilities}
              onChange={(e) => setUnitDetails({ ...unitDetails, estimatedMonthlyUtilities: e.target.value })}
              placeholder="e.g., 150"
              className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Approximate monthly cost for utilities you paid separately
          </p>
        </div>
      )}

      {/* Laundry Section */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Laundry Situation</label>
          <select
            value={unitDetails.laundryType}
            onChange={(e) => setUnitDetails({ ...unitDetails, laundryType: e.target.value as any })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          >
            <option value="in_unit">In-unit washer/dryer</option>
            <option value="in_building">Building laundry (free)</option>
            <option value="coin_op">Building laundry (coin-op/paid)</option>
            <option value="none">No building laundry</option>
          </select>
        </div>

        {unitDetails.laundryType === 'coin_op' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Cost per Load (wash + dry) <span className="text-gray-400">(optional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
              <input
                type="number"
                step="0.25"
                value={unitDetails.laundryCostPerLoad}
                onChange={(e) => setUnitDetails({ ...unitDetails, laundryCostPerLoad: e.target.value })}
                placeholder="e.g., 3.50"
                className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Total cost for one wash + one dry cycle
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setStep('unit-rating')}
          className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderUnitRatingStep = () => (
    <div className="space-y-4">
      <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-6">
        <h3 className="font-semibold text-teal-800 mb-1">Rate Your Unit</h3>
        <p className="text-sm text-teal-700">
          Think about the unit you lived in. Rate how much you agree with each statement.
        </p>
      </div>

      {renderRatingScale()}

      <div className="space-y-2">{unitItems.map(renderRatingItem)}</div>

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={() => setStep('unit-details')}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setStep('building-rating')}
          className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderBuildingRatingStep = () => (
    <div className="space-y-4">
      <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-6">
        <h3 className="font-semibold text-teal-800 mb-1">Rate the Building</h3>
        <p className="text-sm text-teal-700">
          Think about the building as a whole. If something doesn't apply, select "N/A".
        </p>
      </div>

      {renderRatingScale()}

      <div className="space-y-2">{buildingItems.map(renderRatingItem)}</div>

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={() => setStep('unit-rating')}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setStep('landlord-rating')}
          className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderLandlordRatingStep = () => (
    <div className="space-y-4">
      <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 mb-6">
        <h3 className="font-semibold text-teal-800 mb-1">Rate Your Landlord</h3>
        <p className="text-sm text-teal-700">
          Think about your landlord or property management company and your interactions with them.
        </p>
      </div>

      {renderRatingScale()}

      <div className="space-y-2">{landlordItems.map(renderRatingItem)}</div>

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={() => setStep('building-rating')}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setStep('additional')}
          className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderAdditionalStep = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {supplementaryItems.tenure.text}
        </label>
        <select
          value={tenancy.tenure}
          onChange={(e) => setTenancy({ ...tenancy, tenure: parseInt(e.target.value) })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        >
          {supplementaryItems.tenure.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {supplementaryItems.moveOutTiming.text}
        </label>
        <select
          value={tenancy.moveOutYear}
          onChange={(e) => setTenancy({ ...tenancy, moveOutYear: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        >
          {supplementaryItems.moveOutTiming.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {supplementaryItems.wouldRecommend.text}
        </label>
        <div className="flex gap-4">
          {supplementaryItems.wouldRecommend.options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2">
              <input
                type="radio"
                checked={review.wouldRecommend === opt.value}
                onChange={() => setReview({ ...review, wouldRecommend: opt.value })}
                className="text-teal-600 focus:ring-teal-500"
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Additional Comments <span className="text-gray-400">(optional)</span>
        </label>
        <textarea
          value={review.comments}
          onChange={(e) => setReview({ ...review, comments: e.target.value })}
          placeholder="Share any details that would help future tenants. Avoid including identifying information."
          rows={4}
          maxLength={1000}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        />
        <p className="text-sm text-gray-500 mt-1">{review.comments.length}/1000 characters</p>
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => setStep('landlord-rating')}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setStep('confirm')}
          className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
        >
          Review & Submit
        </button>
      </div>
    </div>
  );

  const renderConfirmStep = () => {
    const unitScoreCount = unitItems.filter((item) => scores[item.key] !== undefined).length;
    const buildingScoreCount = buildingItems.filter((item) => scores[item.key] !== undefined).length;
    const landlordScoreCount = landlordItems.filter((item) => scores[item.key] !== undefined).length;

    return (
      <div className="space-y-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex gap-3">
            <div className="shrink-0">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-amber-800 mb-1">Before you submit</h4>
              <p className="text-sm text-amber-700 mb-3">
                Your landlord may be able to identify you based on details in your review. Avoid mentioning
                specific dates, unit numbers, or personal details.
              </p>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={privacyAcknowledged}
                  onChange={(e) => setPrivacyAcknowledged(e.target.checked)}
                  className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                />
                <span className="text-sm text-amber-800">
                  I understand that while my review is anonymous, details may allow the landlord to identify me.
                  I confirm this review is based on my actual experience as a tenant at this property and complies
                  with the{' '}
                  <a href="/terms" target="_blank" className="underline font-medium hover:text-amber-900">
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a href="/guidelines" target="_blank" className="underline font-medium hover:text-amber-900">
                    Review Guidelines
                  </a>
                  .
                </span>
              </label>
            </div>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>}

        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Review Summary</h3>

          {selectedBuilding && (
            <div className="mb-4 pb-4 border-b border-gray-100">
              <div className="text-sm text-gray-500">Building</div>
              <div className="font-medium">{selectedBuilding.address}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Unit:</span>
              <span className="ml-2 font-medium">
                {bedroomOptions.find((b) => b.value === unitDetails.bedrooms)?.label},{' '}
                {bathroomOptions.find((b) => b.value === unitDetails.bathrooms)?.label}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Tenure:</span>
              <span className="ml-2 font-medium">
                {supplementaryItems.tenure.options.find((t) => t.value === tenancy.tenure)?.label}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Unit ratings:</span>
              <span className="ml-2 font-medium">{unitScoreCount}/{unitItems.length}</span>
            </div>
            <div>
              <span className="text-gray-500">Building ratings:</span>
              <span className="ml-2 font-medium">{buildingScoreCount}/{buildingItems.length}</span>
            </div>
            <div>
              <span className="text-gray-500">Landlord ratings:</span>
              <span className="ml-2 font-medium">{landlordScoreCount}/{landlordItems.length}</span>
            </div>
            <div>
              <span className="text-gray-500">Would recommend:</span>
              <span className="ml-2 font-medium capitalize">{review.wouldRecommend}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-between">
          <button
            type="button"
            onClick={() => setStep('additional')}
            className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !privacyAcknowledged}
            className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Submitting...' : 'Submit Review'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      {renderStepIndicator()}

      {step === 'address' && renderAddressStep()}
      {step === 'unit-details' && renderUnitDetailsStep()}
      {step === 'unit-rating' && renderUnitRatingStep()}
      {step === 'building-rating' && renderBuildingRatingStep()}
      {step === 'landlord-rating' && renderLandlordRatingStep()}
      {step === 'additional' && renderAdditionalStep()}
      {step === 'confirm' && renderConfirmStep()}
    </div>
  );
}
