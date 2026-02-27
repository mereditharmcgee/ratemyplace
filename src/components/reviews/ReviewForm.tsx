import { useState } from 'react';
import { unitItems, buildingItems, landlordItems } from '../../lib/surveyItems';
import type { PlaceDetails } from '../AddressAutocomplete';
import {
  StepIndicator,
  AddressStep,
  UnitDetailsStep,
  RatingStep,
  AdditionalStep,
  ConfirmStep,
  type Building,
  type PlaceData,
  type UnitDetails,
  type Tenancy,
  type ReviewData,
  type Step,
} from './form-steps';

interface Props {
  building?: Building | null;
}

export default function ReviewForm({ building }: Props) {
  const [step, setStep] = useState<Step>(building ? 'unit-details' : 'address');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(building || null);
  const [selectedPlace, setSelectedPlace] = useState<PlaceData | null>(null);

  // Unit details
  const [unitDetails, setUnitDetails] = useState<UnitDetails>({
    unitNumber: '',
    bedrooms: '1',
    bathrooms: '1',
    squareFootage: '',
    rentAmount: '',
    amenities: [],
    utilitiesIncluded: [],
    laundryType: 'none',
    laundryCostPerLoad: '',
    estimatedMonthlyUtilities: '',
  });

  // Tenancy info
  const [tenancy, setTenancy] = useState<Tenancy>({
    tenure: 18,
    moveOutYear: 'current',
  });

  // Ratings
  const [scores, setScores] = useState<Record<string, number | null>>({});

  // Review
  const [review, setReview] = useState<ReviewData>({
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
      const response = await fetch(`/api/buildings?placeId=${encodeURIComponent(place.placeId)}`);
      const data = await response.json();

      if (data.building) {
        setSelectedBuilding({
          id: data.building.id,
          address: data.building.address,
          neighborhood: data.building.neighborhood,
          city: data.building.city,
        });
        setSelectedPlace({ ...place, existingBuilding: data.building });
      } else {
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

    if (selectedBuilding) {
      setStep('unit-details');
      return;
    }

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

  const handleScoreChange = (key: string, value: number | null) => {
    setScores({ ...scores, [key]: value });
  };

  return (
    <div>
      <StepIndicator currentStep={step} />

      {step === 'address' && (
        <AddressStep
          selectedPlace={selectedPlace}
          loading={loading}
          error={error}
          onPlaceSelect={handlePlaceSelect}
          onConfirm={handleAddressConfirm}
        />
      )}

      {step === 'unit-details' && (
        <UnitDetailsStep
          building={selectedBuilding}
          unitDetails={unitDetails}
          onChange={setUnitDetails}
          onNext={() => setStep('unit-rating')}
        />
      )}

      {step === 'unit-rating' && (
        <RatingStep
          title="Rate Your Unit"
          description="Think about the unit you lived in. Rate how much you agree with each statement."
          items={unitItems}
          scores={scores}
          onScoreChange={handleScoreChange}
          onBack={() => setStep('unit-details')}
          onNext={() => setStep('building-rating')}
        />
      )}

      {step === 'building-rating' && (
        <RatingStep
          title="Rate the Building"
          description="Think about the building as a whole. If something doesn't apply, select 'N/A'."
          items={buildingItems}
          scores={scores}
          onScoreChange={handleScoreChange}
          onBack={() => setStep('unit-rating')}
          onNext={() => setStep('landlord-rating')}
        />
      )}

      {step === 'landlord-rating' && (
        <RatingStep
          title="Rate Your Landlord"
          description="Think about your landlord or property management company and your interactions with them."
          items={landlordItems}
          scores={scores}
          onScoreChange={handleScoreChange}
          onBack={() => setStep('building-rating')}
          onNext={() => setStep('additional')}
        />
      )}

      {step === 'additional' && (
        <AdditionalStep
          tenancy={tenancy}
          review={review}
          onTenancyChange={setTenancy}
          onReviewChange={setReview}
          onBack={() => setStep('landlord-rating')}
          onNext={() => setStep('confirm')}
        />
      )}

      {step === 'confirm' && (
        <ConfirmStep
          building={selectedBuilding}
          unitDetails={unitDetails}
          tenancy={tenancy}
          review={review}
          scores={scores}
          privacyAcknowledged={privacyAcknowledged}
          onPrivacyChange={setPrivacyAcknowledged}
          loading={loading}
          error={error}
          onBack={() => setStep('additional')}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
