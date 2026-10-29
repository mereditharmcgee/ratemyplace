import { useEffect, useId, useRef, useState } from 'react';
import {
  unitItems,
  buildingItems,
  landlordItems,
  RESPONSE_OPTIONS,
  supplementaryItems,
} from '../../lib/surveyItems';
import {
  bedroomOptions,
  bathroomOptions,
  amenityOptions,
  utilityOptions,
  laundryTypeOptions,
  parkingTypeOptions,
  petTypeOptions,
  pestTypeOptions,
} from '../../lib/formOptions';
import RatingItem, { RatingScale } from './form-steps/RatingItem';
import type { ReviewDetail } from '../../pages/api/reviews/[id]';
import { localityLine } from '../../lib/locality';
import {
  formatMoveIn,
  formatMoveOut,
  givenMoveIn,
  MOVE_IN_NOT_GIVEN,
  moveOutEditChoices,
  moveOutEditValue,
} from '../../lib/privacy';

interface Props {
  review: ReviewDetail;
}

export default function ReviewEditForm({ review }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);

  // Save disables itself while it works, so a failed save moves focus to the error, and a
  // successful one to the panel that replaces the form. errorSeq counts every failed save,
  // so the same message twice in a row still moves focus.
  const [errorSeq, setErrorSeq] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const unitScaleId = useId();
  const buildingScaleId = useId();
  const landlordScaleId = useId();

  // Form state - initialized from existing review
  const [unitType, setUnitType] = useState(review.unit_type || 'unknown');
  const [bedrooms, setBedrooms] = useState((review as any).bedrooms || '1');
  const [bathrooms, setBathrooms] = useState((review as any).bathrooms || '1');
  const [unitNumber, setUnitNumber] = useState((review as any).unit_number || '');
  const [squareFootage, setSquareFootage] = useState((review as any).square_footage?.toString() || '');
  const [rentAmount, setRentAmount] = useState(review.rent_amount?.toString() || '');
  const [reviewTitle, setReviewTitle] = useState(review.review_title || '');
  const [landlordName, setLandlordName] = useState((review as any).landlord_name || '');
  const [hasSeparateManager, setHasSeparateManager] = useState(!!((review as any).property_manager_name));
  const [propertyManagerName, setPropertyManagerName] = useState((review as any).property_manager_name || '');
  const [reviewText, setReviewText] = useState(review.review_text || review.comments || '');

  // Would recommend - canonical text column
  const [wouldRecommend, setWouldRecommend] = useState<string>(
    review.would_recommend_new || 'no'
  );

  // Amenities & utilities
  const [amenities, setAmenities] = useState<string[]>(() => {
    try {
      const parsed = typeof review.amenities === 'string' ? JSON.parse(review.amenities) : review.amenities;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });

  const [utilitiesIncluded, setUtilitiesIncluded] = useState<string[]>(() => {
    try {
      const parsed = typeof review.utilities_included === 'string' ? JSON.parse(review.utilities_included) : review.utilities_included;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });

  // Parking & Pets
  const [parkingType, setParkingType] = useState((review as any).parking_type || '');
  const [petTypes, setPetTypes] = useState<string[]>(() => {
    try {
      const parsed = typeof (review as any).pet_types === 'string' ? JSON.parse((review as any).pet_types) : (review as any).pet_types;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });
  const [pestTypesExperienced, setPestTypesExperienced] = useState<string[]>(() => {
    try {
      const parsed = typeof (review as any).pest_types_experienced === 'string' ? JSON.parse((review as any).pest_types_experienced) : (review as any).pest_types_experienced;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  });

  // Laundry
  const [laundryType, setLaundryType] = useState(review.laundry_type || 'none');
  const [laundryCostPerLoad, setLaundryCostPerLoad] = useState(review.laundry_cost_per_load?.toString() || '');
  const [estimatedMonthlyUtilities, setEstimatedMonthlyUtilities] = useState(
    review.estimated_monthly_utilities?.toString() || ''
  );

  // Move-in month/year. Only the season is stored, so the month starts blank; the route keeps
  // the stored season when the year is left as it was. A skipped move-in starts blank too.
  const [moveInMonth, setMoveInMonth] = useState('');
  const [moveInYear, setMoveInYear] = useState(
    givenMoveIn(review).year?.toString() || ''
  );

  // Tenure & move-out. The select starts at the stored answer, so an untouched save keeps it.
  const [tenureMonths, setTenureMonths] = useState(review.tenure_months || 18);
  const initialMoveOut = moveOutEditValue(review);
  const [moveOutYear, setMoveOutYear] = useState(initialMoveOut);
  const moveOutChoices = moveOutEditChoices(supplementaryItems.moveOutTiming.options, initialMoveOut);
  const moveOut = formatMoveOut({
    moveOutSeason: review.move_out_season,
    moveOutYear: review.move_out_year_new,
    isCurrentTenant: review.is_current_tenant,
  });

  // New survey fields
  const [housingVouchers, setHousingVouchers] = useState<string | null>((review as any).accepts_housing_vouchers || null);
  const [safelyLit, setSafelyLit] = useState<string | null>((review as any).safely_lit_at_night || null);

  // Issue flags
  const [hadPestIssues, setHadPestIssues] = useState(review.had_pest_issues);
  const [hadHeatIssues, setHadHeatIssues] = useState(review.had_heat_issues);
  const [hadWaterIssues, setHadWaterIssues] = useState(review.had_water_issues);
  const [hadDepositIssues, setHadDepositIssues] = useState(review.had_security_deposit_issues);
  const [hadEvictionThreat, setHadEvictionThreat] = useState(review.had_eviction_threat);

  // Initialize scores from existing review using the actual 27 field keys
  const [scores, setScores] = useState<Record<string, number | null>>(() => {
    const initial: Record<string, number | null> = {};
    const allItems = [...unitItems, ...buildingItems, ...landlordItems];

    for (const item of allItems) {
      // Read directly from the review using the actual field key (e.g., unit_structural)
      const value = (review as any)[item.key];
      initial[item.key] = typeof value === 'number' ? value : null;
    }

    return initial;
  });

  useEffect(() => {
    if (errorSeq === 0) return;
    errorRef.current?.focus();
    errorRef.current?.scrollIntoView?.({ block: 'center' });
  }, [errorSeq]);

  useEffect(() => {
    if (success) successRef.current?.focus();
  }, [success]);

  const showError = (message: string) => {
    setError(message);
    setErrorSeq((n) => n + 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Block a review with every rating cleared — the API rejects it too, but this
    // gives the reviewer clear feedback instead of a 400.
    const hasAnyRating = Object.values(scores).some((v) => v !== null);
    if (!hasAnyRating) {
      showError('Please rate at least one item before saving your review.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_type: unitType,
          unit_number: unitNumber || null,
          bedrooms,
          bathrooms,
          square_footage: squareFootage || null,
          rent_amount: rentAmount ? parseInt(rentAmount) : null,
          amenities: JSON.stringify(amenities),
          utilities_included: JSON.stringify(utilitiesIncluded),
          laundry_type: laundryType,
          laundry_cost_per_load: laundryCostPerLoad || null,
          estimated_monthly_utilities: estimatedMonthlyUtilities || null,
          parking_type: parkingType || null,
          pet_types: petTypes.length > 0 ? JSON.stringify(petTypes) : null,
          pest_types_experienced: pestTypesExperienced.length > 0 ? JSON.stringify(pestTypesExperienced) : null,
          move_in_month: moveInMonth ? parseInt(moveInMonth) : null,
          move_in_year: moveInYear ? parseInt(moveInYear) : null,
          tenure_months: tenureMonths,
          move_out_year_new: moveOutYear,
          review_title: reviewTitle || null,
          landlord_name: landlordName || null,
          property_manager_name: hasSeparateManager && propertyManagerName ? propertyManagerName : null,
          review_text: reviewText || null,
          comments: reviewText || null,
          would_recommend_new: wouldRecommend,
          had_pest_issues: hadPestIssues,
          had_heat_issues: hadHeatIssues,
          had_water_issues: hadWaterIssues,
          had_security_deposit_issues: hadDepositIssues,
          had_eviction_threat: hadEvictionThreat,
          accepts_housing_vouchers: housingVouchers || null,
          safely_lit_at_night: safelyLit || null,
          // Send all 27 score fields directly
          ...scores,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(true);
        // Redirect after short delay
        setTimeout(() => {
          window.location.href = '/profile?updated=true';
        }, 1500);
      } else {
        showError(data.error || 'Failed to update review');
      }
    } catch (err) {
      showError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleScoreChange = (key: string, value: number | null) => {
    setScores({ ...scores, [key]: value });
  };

  if (success) {
    return (
      <div ref={successRef} tabIndex={-1} className="bg-green-50 border border-green-200 rounded-[6px] p-6 text-center">
        <svg className="w-12 h-12 text-green-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-lg font-semibold text-green-800 mb-2">Review Updated!</h3>
        <p className="text-green-700">Your edited review will be re-reviewed by our team before going live again. Redirecting to your profile...</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Building Info (read-only) */}
      <div className="bg-paper p-4 rounded-[6px]">
        <div className="font-medium text-gray-900">{review.building_address}</div>
        <div className="text-sm text-gray-600">
          {localityLine({ address: review.building_address, neighborhood: review.neighborhood, city: review.city })}
        </div>
        <div className="text-xs text-gray-600 mt-1">
          Move-in: {formatMoveIn(review) ?? MOVE_IN_NOT_GIVEN}
          {review.is_current_tenant ? ' (Current tenant)' : moveOut && ` - Move-out: ${moveOut}`}
        </div>
      </div>

      {error && (
        <div ref={errorRef} tabIndex={-1} className="bg-red-50 border border-red-200 rounded-[6px] p-4 text-red-700">
          {error}
        </div>
      )}

      {/* Unit Details */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Unit Details</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="review-edit-unit-number" className="block text-sm font-medium text-gray-700 mb-2">
              Unit Number <span className="text-gray-600">(optional)</span>
            </label>
            <input
              id="review-edit-unit-number"
              type="text"
              value={unitNumber}
              onChange={(e) => setUnitNumber(e.target.value)}
              placeholder="e.g., 2A, 301"
              className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
            />
            <p className="text-xs text-gray-600 mt-1">
              For our moderation team only. Never shown publicly.
            </p>
          </div>

          <div>
            <label htmlFor="review-edit-square-footage" className="block text-sm font-medium text-gray-700 mb-2">
              Square Footage <span className="text-gray-600">(optional)</span>
            </label>
            <input
              id="review-edit-square-footage"
              type="number"
              value={squareFootage}
              onChange={(e) => setSquareFootage(e.target.value)}
              placeholder="e.g., 750"
              className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="review-edit-bedrooms" className="block text-sm font-medium text-gray-700 mb-2">Bedrooms</label>
            <select
              id="review-edit-bedrooms"
              value={bedrooms}
              onChange={(e) => setBedrooms(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
            >
              {bedroomOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="review-edit-bathrooms" className="block text-sm font-medium text-gray-700 mb-2">Bathrooms</label>
            <select
              id="review-edit-bathrooms"
              value={bathrooms}
              onChange={(e) => setBathrooms(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
            >
              {bathroomOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <label htmlFor="review-edit-rent-amount" className="block text-sm font-medium text-gray-700 mb-2">
              Monthly Rent <span className="text-gray-600">(optional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600">$</span>
              <input
                id="review-edit-rent-amount"
                type="number"
                value={rentAmount}
                onChange={(e) => setRentAmount(e.target.value)}
                placeholder="e.g., 2500"
                className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Amenities */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Amenities & Utilities</h3>

        <div role="group" aria-labelledby="review-edit-amenities-label">
          <span id="review-edit-amenities-label" className="block text-sm font-medium text-gray-700 mb-3">
            Amenities <span className="text-gray-600">(select all that apply)</span>
          </span>
          <div className="grid grid-cols-2 gap-2">
            {amenityOptions.map((amenity) => (
              <label
                key={amenity.id}
                className={`flex items-center gap-2 p-3 border rounded-[6px] cursor-pointer transition-colors ${
                  amenities.includes(amenity.id)
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={amenities.includes(amenity.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setAmenities([...amenities, amenity.id]);
                    } else {
                      setAmenities(amenities.filter((a) => a !== amenity.id));
                    }
                  }}
                  className="rounded border-gray-300 text-teal-700 focus:ring-teal-700"
                />
                <span className="text-sm text-gray-700">{amenity.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div role="group" aria-labelledby="review-edit-utilities-label">
          <span id="review-edit-utilities-label" className="block text-sm font-medium text-gray-700 mb-3">
            Utilities Included in Rent <span className="text-gray-600">(select all that apply)</span>
          </span>
          <div className="grid grid-cols-2 gap-2">
            {utilityOptions.map((utility) => (
              <label
                key={utility.id}
                className={`flex items-center gap-2 p-3 border rounded-[6px] cursor-pointer transition-colors ${
                  utilitiesIncluded.includes(utility.id)
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={utilitiesIncluded.includes(utility.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setUtilitiesIncluded([...utilitiesIncluded, utility.id]);
                    } else {
                      setUtilitiesIncluded(utilitiesIncluded.filter((u) => u !== utility.id));
                    }
                  }}
                  className="rounded border-gray-300 text-teal-700 focus:ring-teal-700"
                />
                <span className="text-sm text-gray-700">{utility.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Estimated monthly utilities for non-included utilities */}
        {utilitiesIncluded.length < utilityOptions.length && (
          <div>
            <label htmlFor="review-edit-estimated-utilities" className="block text-sm font-medium text-gray-700 mb-2">
              Estimated Monthly Utility Cost <span className="text-gray-600">(for utilities not included)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600">$</span>
              <input
                id="review-edit-estimated-utilities"
                type="number"
                value={estimatedMonthlyUtilities}
                onChange={(e) => setEstimatedMonthlyUtilities(e.target.value)}
                placeholder="e.g., 150"
                className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Approximate monthly cost for utilities you paid separately
            </p>
          </div>
        )}

        {/* Laundry Section */}
        <div className="space-y-4">
          <div>
            <label htmlFor="review-edit-laundry-type" className="block text-sm font-medium text-gray-700 mb-2">Laundry Situation</label>
            <select
              id="review-edit-laundry-type"
              value={laundryType}
              onChange={(e) => setLaundryType(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
            >
              {laundryTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {laundryType === 'coin_op' && (
            <div>
              <label htmlFor="review-edit-laundry-cost" className="block text-sm font-medium text-gray-700 mb-2">
                Cost per Load (wash + dry) <span className="text-gray-600">(optional)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600">$</span>
                <input
                  id="review-edit-laundry-cost"
                  type="number"
                  step="0.25"
                  value={laundryCostPerLoad}
                  onChange={(e) => setLaundryCostPerLoad(e.target.value)}
                  placeholder="e.g., 3.50"
                  className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
                />
              </div>
              <p className="text-xs text-gray-600 mt-1">
                Total cost for one wash + one dry cycle
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Parking */}
      <div>
        <label htmlFor="review-edit-parking-type" className="block text-sm font-medium text-gray-700 mb-2">
          Parking Situation <span className="text-gray-600">(optional)</span>
        </label>
        <select
          id="review-edit-parking-type"
          value={parkingType}
          onChange={(e) => setParkingType(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
        >
          <option value="">Select...</option>
          {parkingTypeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Pets */}
      <div role="group" aria-labelledby="review-edit-pets-label">
        <span id="review-edit-pets-label" className="block text-sm font-medium text-gray-700 mb-3">
          Pets Allowed <span className="text-gray-600">(select all that apply)</span>
        </span>
        <div className="grid grid-cols-2 gap-2">
          {petTypeOptions.map((pet) => (
            <label
              key={pet.id}
              className={`flex items-center gap-2 p-3 border rounded-[6px] cursor-pointer transition-colors ${
                petTypes.includes(pet.id) ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={petTypes.includes(pet.id)}
                onChange={(e) => {
                  if (e.target.checked) setPetTypes([...petTypes, pet.id]);
                  else setPetTypes(petTypes.filter((p) => p !== pet.id));
                }}
                className="rounded border-gray-300 text-teal-700 focus:ring-teal-700"
              />
              <span className="text-sm text-gray-700">{pet.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Unit Ratings */}
      <div className="space-y-4">
        <div className="bg-teal-50 border border-teal-200 rounded-[6px] p-4">
          <h3 className="font-semibold text-teal-800 mb-1">Rate Your Unit</h3>
          <p className="text-sm text-teal-700">
            Think about the unit you lived in. Rate how much you agree with each statement.
          </p>
        </div>
        <RatingScale id={unitScaleId} />
        <div className="space-y-2">
          {unitItems.map((item) => (
            <RatingItem
              key={item.key}
              item={item}
              value={scores[item.key]}
              onChange={handleScoreChange}
              describedBy={unitScaleId}
            />
          ))}
        </div>
      </div>

      {/* Building Ratings */}
      <div className="space-y-4">
        <div className="bg-teal-50 border border-teal-200 rounded-[6px] p-4">
          <h3 className="font-semibold text-teal-800 mb-1">Rate the Building</h3>
          <p className="text-sm text-teal-700">
            Think about the building as a whole. If something doesn't apply, select "N/A".
          </p>
        </div>
        <RatingScale id={buildingScaleId} />
        <div className="space-y-2">
          {buildingItems.map((item) => (
            <RatingItem
              key={item.key}
              item={item}
              value={scores[item.key]}
              onChange={handleScoreChange}
              describedBy={buildingScaleId}
            />
          ))}
        </div>
      </div>

      {/* Landlord Ratings */}
      <div className="space-y-4">
        <div className="bg-teal-50 border border-teal-200 rounded-[6px] p-4">
          <h3 className="font-semibold text-teal-800 mb-1">Rate Your Landlord</h3>
          <p className="text-sm text-teal-700">
            Think about your landlord or property management.
          </p>
        </div>

        <div>
          <label htmlFor="review-edit-landlord-name" className="block text-sm font-medium text-gray-700 mb-2">
            Who was your landlord or property manager? <span className="text-gray-600">(optional)</span>
          </label>
          <input
            id="review-edit-landlord-name"
            type="text"
            value={landlordName}
            onChange={(e) => setLandlordName(e.target.value)}
            placeholder="e.g. Samia Management, John Smith"
            maxLength={200}
            className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
          />
          <p className="text-sm text-gray-600 mt-1">This helps us link reviews to the right landlord. It won't be shown publicly on your review.</p>

          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={hasSeparateManager}
              onChange={(e) => {
                setHasSeparateManager(e.target.checked);
                if (!e.target.checked) setPropertyManagerName('');
              }}
              className="rounded border-gray-300 text-teal-700 focus:ring-teal-700"
            />
            <span className="text-sm text-gray-700">Someone else manages the property</span>
          </label>

          {hasSeparateManager && (
            <div className="mt-3">
              <label htmlFor="review-edit-property-manager-name" className="block text-sm font-medium text-gray-700 mb-2">
                Who manages the property? <span className="text-gray-600">(optional)</span>
              </label>
              <input
                id="review-edit-property-manager-name"
                type="text"
                value={propertyManagerName}
                onChange={(e) => setPropertyManagerName(e.target.value)}
                placeholder="e.g. ABC Property Management"
                maxLength={200}
                className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
              />
              <p className="text-sm text-gray-600 mt-1">The company or person who handles day-to-day management (maintenance, rent collection, etc.)</p>
            </div>
          )}
        </div>

        <RatingScale id={landlordScaleId} />
        <div className="space-y-2">
          {landlordItems.map((item) => (
            <RatingItem
              key={item.key}
              item={item}
              value={scores[item.key]}
              onChange={handleScoreChange}
              describedBy={landlordScaleId}
            />
          ))}
        </div>
      </div>

      {/* Issues */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Issues Experienced</h3>
        <div className="grid grid-cols-2 gap-4">
          <label
            className={`flex items-center gap-2 p-3 border rounded-[6px] cursor-pointer transition-colors ${
              hadPestIssues ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <input
              type="checkbox"
              checked={hadPestIssues}
              onChange={(e) => {
                setHadPestIssues(e.target.checked);
                if (!e.target.checked) setPestTypesExperienced([]);
              }}
              className="rounded border-gray-300 text-red-700 focus:ring-red-500"
            />
            <span className="text-sm text-gray-700">Pest issues</span>
          </label>
          {hadPestIssues && (
            <div className="col-span-2">
              <p className="text-xs text-gray-600 mb-2">What pests did you encounter?</p>
              <div className="flex flex-wrap gap-2">
                {pestTypeOptions.map((pest) => (
                  <label
                    key={pest.id}
                    className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-full cursor-pointer text-xs transition-colors ${
                      pestTypesExperienced.includes(pest.id)
                        ? 'border-red-400 bg-red-50 text-red-800'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={pestTypesExperienced.includes(pest.id)}
                      onChange={(e) => {
                        if (e.target.checked) setPestTypesExperienced([...pestTypesExperienced, pest.id]);
                        else setPestTypesExperienced(pestTypesExperienced.filter((p) => p !== pest.id));
                      }}
                      className="sr-only"
                    />
                    {pest.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          {[
            { label: 'Heat issues', value: hadHeatIssues, setter: setHadHeatIssues },
            { label: 'Water issues', value: hadWaterIssues, setter: setHadWaterIssues },
            { label: 'Deposit issues', value: hadDepositIssues, setter: setHadDepositIssues },
            { label: 'Eviction threats', value: hadEvictionThreat, setter: setHadEvictionThreat },
          ].map((issue) => (
            <label
              key={issue.label}
              className={`flex items-center gap-2 p-3 border rounded-[6px] cursor-pointer transition-colors ${
                issue.value ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={issue.value}
                onChange={(e) => issue.setter(e.target.checked)}
                className="rounded border-gray-300 text-red-700 focus:ring-red-500"
              />
              <span className="text-sm text-gray-700">{issue.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Tenure & Move-out */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Tenancy Details</h3>

        {/* Move-in date */}
        <div role="group" aria-labelledby="review-edit-move-in-label">
          <span id="review-edit-move-in-label" className="block text-sm font-medium text-gray-700 mb-2">
            When did you move in?
          </span>
          <div className="grid grid-cols-2 gap-3">
            <select
              id="review-edit-move-in-month"
              aria-label="Move-in month"
              value={moveInMonth}
              onChange={(e) => setMoveInMonth(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
            >
              <option value="">Month</option>
              <option value="1">January</option>
              <option value="2">February</option>
              <option value="3">March</option>
              <option value="4">April</option>
              <option value="5">May</option>
              <option value="6">June</option>
              <option value="7">July</option>
              <option value="8">August</option>
              <option value="9">September</option>
              <option value="10">October</option>
              <option value="11">November</option>
              <option value="12">December</option>
            </select>
            <select
              id="review-edit-move-in-year"
              aria-label="Move-in year"
              value={moveInYear}
              onChange={(e) => setMoveInYear(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
            >
              <option value="">Year</option>
              {Array.from({ length: new Date().getFullYear() - 1999 }, (_, i) => new Date().getFullYear() - i).map((year) => (
                <option key={year} value={year.toString()}>{year}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {supplementaryItems.tenure.text}
            </label>
            <select
              value={tenureMonths}
              onChange={(e) => setTenureMonths(parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500 focus:border-transparent"
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
              value={moveOutYear}
              onChange={(e) => setMoveOutYear(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            >
              {moveOutChoices.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Housing Vouchers */}
      <div role="group" aria-labelledby="review-edit-housing-vouchers-label" className="space-y-2">
        <span id="review-edit-housing-vouchers-label" className="block text-sm font-medium text-gray-700">
          {supplementaryItems.housingVouchers.text} <span className="text-gray-600">(optional)</span>
        </span>
        <div className="flex gap-4">
          {supplementaryItems.housingVouchers.options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2">
              <input
                type="radio"
                checked={housingVouchers === opt.value}
                onChange={() => setHousingVouchers(opt.value)}
                className="text-teal-700 focus:ring-teal-700"
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Safely Lit at Night */}
      <div role="group" aria-labelledby="review-edit-safely-lit-label" className="space-y-2">
        <span id="review-edit-safely-lit-label" className="block text-sm font-medium text-gray-700">
          {supplementaryItems.safelyLit.text} <span className="text-gray-600">(optional)</span>
        </span>
        <div className="flex gap-4">
          {supplementaryItems.safelyLit.options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2">
              <input
                type="radio"
                checked={safelyLit === opt.value}
                onChange={() => setSafelyLit(opt.value)}
                className="text-teal-700 focus:ring-teal-700"
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Recommendation */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">
          {supplementaryItems.wouldRecommend.text}
        </h3>
        <div className="flex gap-4">
          {supplementaryItems.wouldRecommend.options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2">
              <input
                type="radio"
                checked={wouldRecommend === opt.value}
                onChange={() => setWouldRecommend(opt.value)}
                className="text-teal-700 focus:ring-teal-700"
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Review Text */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Your Review</h3>

        <div>
          <label htmlFor="review-edit-review-title" className="block text-sm font-medium text-gray-700 mb-2">
            Review Title <span className="text-gray-600">(optional)</span>
          </label>
          <input
            id="review-edit-review-title"
            type="text"
            value={reviewTitle}
            onChange={(e) => setReviewTitle(e.target.value)}
            placeholder="Summarize your experience"
            maxLength={100}
            className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
          />
        </div>

        <div>
          <label htmlFor="review-edit-review-text" className="block text-sm font-medium text-gray-700 mb-2">
            Additional Comments <span className="text-gray-600">(optional)</span>
          </label>
          <textarea
            id="review-edit-review-text"
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="Share any details that would help future tenants. Avoid including identifying information."
            rows={4}
            maxLength={1000}
            className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent"
          />
          <p className="text-sm text-gray-600 mt-1">{reviewText.length}/1000 characters</p>
        </div>
      </div>

      {/* Consent Checkbox */}
      <div className="bg-amber-50 border border-amber-200 rounded-[6px] p-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={consentAcknowledged}
            onChange={(e) => setConsentAcknowledged(e.target.checked)}
            className="mt-0.5 rounded border-amber-400 text-amber-700 focus:ring-amber-500"
          />
          <span className="text-sm text-amber-800">
            I confirm this review reflects my honest personal experience and agree to the{' '}
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

      {/* Actions */}
      <div className="flex gap-4 pt-4 border-t">
        <a
          href="/profile"
          className="flex-1 px-6 py-3 border border-gray-300 rounded-[6px] text-gray-700 hover:bg-gray-50 text-center transition-colors"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={loading || !consentAcknowledged}
          className="flex-1 px-6 py-3 bg-teal-700 text-white font-semibold rounded-[4px] hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
