import { useState } from 'react';
import {
  unitItems,
  buildingItems,
  landlordItems,
  RESPONSE_OPTIONS,
  supplementaryItems,
  type SurveyItem,
} from '../../lib/surveyItems';
import type { ReviewDetail } from '../../pages/api/reviews/[id]';

interface Props {
  review: ReviewDetail;
}

const unitTypeOptions = [
  { value: 'studio', label: 'Studio' },
  { value: '1br', label: '1 Bedroom' },
  { value: '2br', label: '2 Bedrooms' },
  { value: '3br', label: '3 Bedrooms' },
  { value: '4br+', label: '4+ Bedrooms' },
  { value: 'house', label: 'House' },
];

export default function ReviewEditForm({ review }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form state - initialized from existing review
  const [unitType, setUnitType] = useState(review.unit_type);
  const [rentAmount, setRentAmount] = useState(review.rent_amount?.toString() || '');
  const [reviewTitle, setReviewTitle] = useState(review.review_title || '');
  const [reviewText, setReviewText] = useState(review.review_text || '');
  const [wouldRecommend, setWouldRecommend] = useState(review.would_recommend);

  // Issue flags
  const [hadPestIssues, setHadPestIssues] = useState(review.had_pest_issues);
  const [hadHeatIssues, setHadHeatIssues] = useState(review.had_heat_issues);
  const [hadWaterIssues, setHadWaterIssues] = useState(review.had_water_issues);
  const [hadDepositIssues, setHadDepositIssues] = useState(review.had_security_deposit_issues);
  const [hadEvictionThreat, setHadEvictionThreat] = useState(review.had_eviction_threat);

  // Initialize scores from existing review
  const [scores, setScores] = useState<Record<string, number | null>>(() => {
    const initial: Record<string, number | null> = {};
    // Map existing scores to survey item keys
    const scoreMapping: Record<string, keyof ReviewDetail> = {
      unit_structural: 'score_building_quality',
      unit_plumbing: 'score_maintenance',
      unit_pests: 'score_pest_control',
      building_security: 'score_safety',
      building_noise_neighbors: 'score_noise',
      landlord_maintenance: 'score_landlord_responsiveness',
      landlord_communication: 'score_landlord_communication',
      landlord_professionalism: 'score_landlord_fairness',
      landlord_lease_clarity: 'score_lease_clarity',
      landlord_deposit: 'score_deposit_handling',
      building_common_areas: 'score_rent_value',
      building_exterior: 'score_amenities',
    };

    Object.entries(scoreMapping).forEach(([key, reviewKey]) => {
      initial[key] = review[reviewKey] as number | null;
    });

    return initial;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_type: unitType,
          rent_amount: rentAmount ? parseInt(rentAmount) : null,
          review_title: reviewTitle || null,
          review_text: reviewText || null,
          would_recommend: wouldRecommend,
          had_pest_issues: hadPestIssues,
          had_heat_issues: hadHeatIssues,
          had_water_issues: hadWaterIssues,
          had_security_deposit_issues: hadDepositIssues,
          had_eviction_threat: hadEvictionThreat,
          // Map survey keys back to score columns
          score_building_quality: scores.unit_structural,
          score_maintenance: scores.unit_plumbing,
          score_pest_control: scores.unit_pests,
          score_safety: scores.building_security,
          score_noise: scores.building_noise_neighbors,
          score_landlord_responsiveness: scores.landlord_maintenance,
          score_landlord_communication: scores.landlord_communication,
          score_landlord_fairness: scores.landlord_professionalism,
          score_lease_clarity: scores.landlord_lease_clarity,
          score_deposit_handling: scores.landlord_deposit,
          score_rent_value: scores.building_common_areas,
          score_amenities: scores.building_exterior,
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
        setError(data.error || 'Failed to update review');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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

  if (success) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
        <svg className="w-12 h-12 text-green-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-lg font-semibold text-green-800 mb-2">Review Updated!</h3>
        <p className="text-green-700">Redirecting to your profile...</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Building Info (read-only) */}
      <div className="bg-slate-50 p-4 rounded-lg">
        <div className="font-medium text-gray-900">{review.building_address}</div>
        <div className="text-sm text-gray-500">
          {review.neighborhood && `${review.neighborhood}, `}{review.city}
        </div>
        <div className="text-xs text-gray-400 mt-1">
          Move-in: {review.move_in_season} {review.move_in_year}
          {review.is_current_tenant ? ' (Current tenant)' : review.move_out_year && ` - Move-out: ${review.move_out_season} ${review.move_out_year}`}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {/* Unit Details */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Unit Details</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Unit Type</label>
            <select
              value={unitType}
              onChange={(e) => setUnitType(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            >
              {unitTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Monthly Rent <span className="text-gray-400">(optional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
              <input
                type="number"
                value={rentAmount}
                onChange={(e) => setRentAmount(e.target.value)}
                placeholder="e.g., 2500"
                className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Unit Ratings */}
      <div className="space-y-4">
        <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
          <h3 className="font-semibold text-teal-800 mb-1">Rate Your Unit</h3>
          <p className="text-sm text-teal-700">
            Think about the unit you lived in. Rate how much you agree with each statement.
          </p>
        </div>
        {renderRatingScale()}
        <div className="space-y-2">{unitItems.slice(0, 5).map(renderRatingItem)}</div>
      </div>

      {/* Building Ratings */}
      <div className="space-y-4">
        <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
          <h3 className="font-semibold text-teal-800 mb-1">Rate the Building</h3>
          <p className="text-sm text-teal-700">
            Think about the building as a whole.
          </p>
        </div>
        {renderRatingScale()}
        <div className="space-y-2">{buildingItems.slice(0, 5).map(renderRatingItem)}</div>
      </div>

      {/* Landlord Ratings */}
      <div className="space-y-4">
        <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
          <h3 className="font-semibold text-teal-800 mb-1">Rate Your Landlord</h3>
          <p className="text-sm text-teal-700">
            Think about your landlord or property management.
          </p>
        </div>
        {renderRatingScale()}
        <div className="space-y-2">{landlordItems.slice(0, 5).map(renderRatingItem)}</div>
      </div>

      {/* Issues */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Issues Experienced</h3>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Pest issues', value: hadPestIssues, setter: setHadPestIssues },
            { label: 'Heat issues', value: hadHeatIssues, setter: setHadHeatIssues },
            { label: 'Water issues', value: hadWaterIssues, setter: setHadWaterIssues },
            { label: 'Deposit issues', value: hadDepositIssues, setter: setHadDepositIssues },
            { label: 'Eviction threats', value: hadEvictionThreat, setter: setHadEvictionThreat },
          ].map((issue) => (
            <label
              key={issue.label}
              className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                issue.value ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={issue.value}
                onChange={(e) => issue.setter(e.target.checked)}
                className="rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              <span className="text-sm text-gray-700">{issue.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Recommendation */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Would you recommend this place?</h3>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={wouldRecommend}
              onChange={() => setWouldRecommend(true)}
              className="text-teal-600 focus:ring-teal-500"
            />
            <span>Yes</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={!wouldRecommend}
              onChange={() => setWouldRecommend(false)}
              className="text-teal-600 focus:ring-teal-500"
            />
            <span>No</span>
          </label>
        </div>
      </div>

      {/* Review Text */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Your Review</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Review Title <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={reviewTitle}
            onChange={(e) => setReviewTitle(e.target.value)}
            placeholder="Summarize your experience"
            maxLength={100}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Additional Comments <span className="text-gray-400">(optional)</span>
          </label>
          <textarea
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="Share any details that would help future tenants. Avoid including identifying information."
            rows={4}
            maxLength={1000}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
          <p className="text-sm text-gray-500 mt-1">{reviewText.length}/1000 characters</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-4 pt-4 border-t">
        <a
          href="/profile"
          className="flex-1 px-6 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-center transition-colors"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
