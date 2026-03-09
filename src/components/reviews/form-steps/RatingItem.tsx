import type { SurveyItem } from '../../../lib/surveyItems';
import { HelpTooltip } from '../HelpTooltip';

interface Props {
  item: SurveyItem;
  value: number | null | undefined;
  onChange: (key: string, value: number | null) => void;
}

export default function RatingItem({ item, value, onChange }: Props) {
  return (
    <div className="py-4 border-b border-gray-100 last:border-0">
      <div className="mb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <span className="text-xs text-gray-400 font-mono mr-2">{item.code}</span>
            <span className="font-medium text-gray-900">{item.dimension}</span>
            {item.required && <span className="text-red-500 ml-1">*</span>}
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
            onClick={() => onChange(item.key, rating)}
            className={`w-10 h-10 rounded-full text-sm font-medium transition-all ${
              value === rating
                ? rating <= 2
                  ? 'bg-red-500 text-white'
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
            onClick={() => onChange(item.key, null)}
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
}

export function RatingScale() {
  return (
    <div className="flex justify-between items-center text-xs text-gray-500 mb-4 px-2">
      <span className="text-red-600 font-medium">1 = Strongly Disagree</span>
      <span className="text-gray-400">3 = Neutral</span>
      <span className="text-emerald-600 font-medium">5 = Strongly Agree</span>
    </div>
  );
}
