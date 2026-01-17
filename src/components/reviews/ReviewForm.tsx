import { useState } from 'react';
import { surveyItems, issueItems } from '../../lib/surveyItems';

interface Building {
  id: string;
  address: string;
  neighborhood?: string;
  city: string;
}

interface Props {
  building?: Building | null;
}

type Step = 'address' | 'tenancy' | 'ratings' | 'issues' | 'review' | 'confirm';

const seasons = [
  { value: 'winter', label: 'Winter (Dec-Feb)' },
  { value: 'spring', label: 'Spring (Mar-May)' },
  { value: 'summer', label: 'Summer (Jun-Aug)' },
  { value: 'fall', label: 'Fall (Sep-Nov)' },
];

const unitTypes = [
  { value: 'studio', label: 'Studio' },
  { value: '1br', label: '1 Bedroom' },
  { value: '2br', label: '2 Bedrooms' },
  { value: '3br', label: '3 Bedrooms' },
  { value: '4br+', label: '4+ Bedrooms' },
  { value: 'house', label: 'House' },
];

const currentYear = new Date().getFullYear();
const years = Array.from({ length: 30 }, (_, i) => currentYear - i);

export default function ReviewForm({ building }: Props) {
  const [step, setStep] = useState<Step>(building ? 'tenancy' : 'address');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [addressSearch, setAddressSearch] = useState('');
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(building || null);
  const [searchResults, setSearchResults] = useState<Building[]>([]);

  const [tenancy, setTenancy] = useState({
    moveInYear: currentYear,
    moveInSeason: 'fall',
    moveOutYear: currentYear,
    moveOutSeason: 'fall',
    isCurrentTenant: false,
    unitType: '1br',
    rentAmount: '',
  });

  const [scores, setScores] = useState<Record<string, number>>({});

  const [issues, setIssues] = useState<Record<string, boolean>>({
    pest: false,
    heat: false,
    water: false,
    deposit: false,
    eviction: false,
  });

  const [review, setReview] = useState({
    title: '',
    text: '',
    wouldRecommend: true,
  });

  const handleAddressSearch = async () => {
    if (!addressSearch.trim()) return;

    try {
      const response = await fetch(`/api/buildings?q=${encodeURIComponent(addressSearch)}`);
      const data = await response.json();
      setSearchResults(data.buildings || []);
    } catch (err) {
      console.error('Search error:', err);
    }
  };

  const handleSubmit = async () => {
    if (!selectedBuilding) return;

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('building_id', selectedBuilding.id);
      formData.append('move_in_year', tenancy.moveInYear.toString());
      formData.append('move_in_season', tenancy.moveInSeason);
      formData.append('is_current_tenant', tenancy.isCurrentTenant ? '1' : '0');

      if (!tenancy.isCurrentTenant) {
        formData.append('move_out_year', tenancy.moveOutYear.toString());
        formData.append('move_out_season', tenancy.moveOutSeason);
      }

      formData.append('unit_type', tenancy.unitType);
      if (tenancy.rentAmount) {
        formData.append('rent_amount', tenancy.rentAmount);
      }

      // Add scores
      for (const [key, value] of Object.entries(scores)) {
        formData.append(`score_${key}`, value.toString());
      }

      // Add issues
      for (const [key, value] of Object.entries(issues)) {
        formData.append(`had_${key}_issues`, value ? '1' : '0');
      }

      formData.append('would_recommend', review.wouldRecommend ? '1' : '0');
      if (review.title) formData.append('review_title', review.title);
      if (review.text) formData.append('review_text', review.text);

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

  const renderStepIndicator = () => {
    const steps = ['Address', 'Tenancy', 'Ratings', 'Issues', 'Review', 'Submit'];
    const stepIndex = ['address', 'tenancy', 'ratings', 'issues', 'review', 'confirm'].indexOf(step);

    return (
      <div className="flex items-center justify-between mb-8">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                i <= stepIndex
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              {i + 1}
            </div>
            <span className="hidden sm:block ml-2 text-sm text-gray-600">{s}</span>
            {i < steps.length - 1 && (
              <div className={`w-8 sm:w-16 h-1 mx-2 ${i < stepIndex ? 'bg-blue-600' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>
    );
  };

  const renderAddressStep = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Search for your building address
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={addressSearch}
            onChange={(e) => setAddressSearch(e.target.value)}
            placeholder="Enter street address..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={handleAddressSearch}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Search
          </button>
        </div>
      </div>

      {searchResults.length > 0 && (
        <div className="space-y-2">
          {searchResults.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setSelectedBuilding(b);
                setStep('tenancy');
              }}
              className="w-full text-left p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50"
            >
              <div className="font-medium">{b.address}</div>
              <div className="text-sm text-gray-500">
                {b.neighborhood && `${b.neighborhood}, `}{b.city}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="text-center text-sm text-gray-500">
        <p>Can't find your address?</p>
        <button
          type="button"
          onClick={() => setStep('tenancy')}
          className="text-blue-600 hover:text-blue-800"
        >
          Add a new building
        </button>
      </div>
    </div>
  );

  const renderTenancyStep = () => (
    <div className="space-y-6">
      {selectedBuilding && (
        <div className="bg-gray-50 p-4 rounded-lg mb-6">
          <div className="font-medium">{selectedBuilding.address}</div>
          <div className="text-sm text-gray-500">
            {selectedBuilding.neighborhood && `${selectedBuilding.neighborhood}, `}
            {selectedBuilding.city}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Move-in Year</label>
          <select
            value={tenancy.moveInYear}
            onChange={(e) => setTenancy({ ...tenancy, moveInYear: parseInt(e.target.value) })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Move-in Season</label>
          <select
            value={tenancy.moveInSeason}
            onChange={(e) => setTenancy({ ...tenancy, moveInSeason: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          >
            {seasons.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={tenancy.isCurrentTenant}
            onChange={(e) => setTenancy({ ...tenancy, isCurrentTenant: e.target.checked })}
            className="rounded border-gray-300"
          />
          <span className="text-sm font-medium text-gray-700">I currently live here</span>
        </label>
      </div>

      {!tenancy.isCurrentTenant && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Move-out Year</label>
            <select
              value={tenancy.moveOutYear}
              onChange={(e) => setTenancy({ ...tenancy, moveOutYear: parseInt(e.target.value) })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Move-out Season</label>
            <select
              value={tenancy.moveOutSeason}
              onChange={(e) => setTenancy({ ...tenancy, moveOutSeason: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            >
              {seasons.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Unit Type</label>
          <select
            value={tenancy.unitType}
            onChange={(e) => setTenancy({ ...tenancy, unitType: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          >
            {unitTypes.map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Monthly Rent (optional)</label>
          <input
            type="number"
            value={tenancy.rentAmount}
            onChange={(e) => setTenancy({ ...tenancy, rentAmount: e.target.value })}
            placeholder="$ per month"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setStep('ratings')}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderRatingsStep = () => (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 mb-4">
        Rate each aspect from 1 (poor) to 5 (excellent). Skip any that don't apply.
      </p>

      {['building', 'landlord', 'value'].map((category) => (
        <div key={category} className="mb-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 capitalize">
            {category === 'building' ? 'Building Quality' : category === 'landlord' ? 'Landlord Experience' : 'Value'}
          </h3>
          <div className="space-y-4">
            {surveyItems
              .filter((item) => item.category === category)
              .map((item) => (
                <div key={item.id} className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">{item.label}</div>
                    <div className="text-sm text-gray-500">{item.description}</div>
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setScores({ ...scores, [item.id]: value })}
                        className={`w-10 h-10 rounded-full text-sm font-medium ${
                          scores[item.id] === value
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => setStep('tenancy')}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setStep('issues')}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderIssuesStep = () => (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 mb-4">
        Did you experience any of these issues during your tenancy?
      </p>

      <div className="space-y-4">
        {issueItems.map((item) => (
          <label
            key={item.id}
            className="flex items-start gap-3 p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={issues[item.id] || false}
              onChange={(e) => setIssues({ ...issues, [item.id]: e.target.checked })}
              className="mt-1 rounded border-gray-300"
            />
            <div>
              <div className="font-medium text-gray-900">{item.label}</div>
              <div className="text-sm text-gray-500">{item.description}</div>
            </div>
          </label>
        ))}
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => setStep('ratings')}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setStep('review')}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Continue
        </button>
      </div>
    </div>
  );

  const renderReviewStep = () => (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Review Title (optional)
        </label>
        <input
          type="text"
          value={review.title}
          onChange={(e) => setReview({ ...review, title: e.target.value })}
          placeholder="Summarize your experience in a few words"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          maxLength={200}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Your Review (optional)
        </label>
        <textarea
          value={review.text}
          onChange={(e) => setReview({ ...review, text: e.target.value })}
          placeholder="Share details about your experience living here..."
          rows={6}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          maxLength={5000}
        />
        <p className="text-sm text-gray-500 mt-1">{review.text.length}/5000 characters</p>
      </div>

      <div className="p-4 bg-gray-50 rounded-lg">
        <div className="font-medium text-gray-900 mb-3">
          Would you recommend this building to other tenants?
        </div>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={review.wouldRecommend}
              onChange={() => setReview({ ...review, wouldRecommend: true })}
              className="text-blue-600"
            />
            <span>Yes</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={!review.wouldRecommend}
              onChange={() => setReview({ ...review, wouldRecommend: false })}
              className="text-blue-600"
            />
            <span>No</span>
          </label>
        </div>
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => setStep('issues')}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => setStep('confirm')}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Review & Submit
        </button>
      </div>
    </div>
  );

  const renderConfirmStep = () => (
    <div className="space-y-6">
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="font-semibold text-yellow-800 mb-2">Before you submit</h3>
        <ul className="text-sm text-yellow-700 space-y-1">
          <li>Your review will be checked by our team before publishing.</li>
          <li>Make sure your review is honest and based on your actual experience.</li>
          <li>Don't include personal information about landlords or other tenants.</li>
        </ul>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

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
            <span className="text-gray-500">Unit Type:</span>
            <span className="ml-2 font-medium">
              {unitTypes.find((u) => u.value === tenancy.unitType)?.label}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Move-in:</span>
            <span className="ml-2 font-medium">
              {seasons.find((s) => s.value === tenancy.moveInSeason)?.label.split(' ')[0]} {tenancy.moveInYear}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Scores rated:</span>
            <span className="ml-2 font-medium">{Object.keys(scores).length}/12</span>
          </div>
          <div>
            <span className="text-gray-500">Would recommend:</span>
            <span className="ml-2 font-medium">{review.wouldRecommend ? 'Yes' : 'No'}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={() => setStep('review')}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Submitting...' : 'Submit Review'}
        </button>
      </div>
    </div>
  );

  return (
    <div>
      {renderStepIndicator()}

      {step === 'address' && renderAddressStep()}
      {step === 'tenancy' && renderTenancyStep()}
      {step === 'ratings' && renderRatingsStep()}
      {step === 'issues' && renderIssuesStep()}
      {step === 'review' && renderReviewStep()}
      {step === 'confirm' && renderConfirmStep()}
    </div>
  );
}
