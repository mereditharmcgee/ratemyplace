import type { SurveyItem } from '../../../lib/surveyItems';
import RatingItem, { RatingScale } from './RatingItem';

interface Props {
  title: string;
  description: string;
  items: SurveyItem[];
  scores: Record<string, number | null>;
  onScoreChange: (key: string, value: number | null) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function RatingStep({
  title,
  description,
  items,
  scores,
  onScoreChange,
  onBack,
  onNext,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="bg-teal-50 border border-teal-200 rounded-[6px] p-4 mb-6">
        <h3 className="font-semibold text-teal-800 mb-1">{title}</h3>
        <p className="text-sm text-teal-700">{description}</p>
      </div>

      <RatingScale />

      <div className="space-y-2">
        {items.map((item) => (
          <RatingItem
            key={item.key}
            item={item}
            value={scores[item.key]}
            onChange={onScoreChange}
          />
        ))}
      </div>

      <div className="flex justify-between pt-4">
        <button
          type="button"
          onClick={onBack}
          className="h-11 inline-flex items-center justify-center px-6 border border-gray-300 rounded-[6px] hover:bg-gray-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="h-11 inline-flex items-center justify-center px-6 bg-teal-700 text-white font-semibold rounded-[4px] hover:bg-teal-800"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
