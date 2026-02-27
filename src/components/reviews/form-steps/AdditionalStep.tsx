import { supplementaryItems } from '../../../lib/surveyItems';
import type { Tenancy, ReviewData } from './types';

interface Props {
  tenancy: Tenancy;
  review: ReviewData;
  onTenancyChange: (tenancy: Tenancy) => void;
  onReviewChange: (review: ReviewData) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function AdditionalStep({
  tenancy,
  review,
  onTenancyChange,
  onReviewChange,
  onBack,
  onNext,
}: Props) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {supplementaryItems.tenure.text}
        </label>
        <select
          value={tenancy.tenure}
          onChange={(e) => onTenancyChange({ ...tenancy, tenure: parseInt(e.target.value) })}
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
          onChange={(e) => onTenancyChange({ ...tenancy, moveOutYear: e.target.value })}
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
                onChange={() => onReviewChange({ ...review, wouldRecommend: opt.value })}
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
          onChange={(e) => onReviewChange({ ...review, comments: e.target.value })}
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
          onClick={onBack}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
        >
          Review & Submit
        </button>
      </div>
    </div>
  );
}
