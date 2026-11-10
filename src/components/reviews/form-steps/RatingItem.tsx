import { useId, type KeyboardEvent } from 'react';
import type { SurveyItem } from '../../../lib/surveyItems';
import { HelpTooltip } from '../HelpTooltip';

interface Props {
  item: SurveyItem;
  value: number | null | undefined;
  onChange: (key: string, value: number | null) => void;
  /** Id of the RatingScale above the questions, read as each group's description. */
  describedBy?: string;
}

// Each answer is a native radio, visually hidden, inside a label whose span is the pill. The
// span keeps the old button's look and adds what a span needs that a button had for free
// (centered text that a double click does not select), the keyboard focus outline taken from
// the radio, and an invisible 44x44 hit area around the 40px pill. The radios call the same
// onChange as the buttons did, so the answers held in state, and therefore the submitted
// payload, are unchanged.
const PILL_A11Y =
  "inline-flex items-center justify-center select-none peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-teal-700 motion-reduce:transition-none before:absolute before:-inset-0.5 before:content-['']";

export default function RatingItem({ item, value, onChange, describedBy }: Props) {
  const dimId = useId();
  const textId = useId();
  const name = `rating-${item.key}`;

  // Enter on a radio submits the form around it, and the edit page is a form: one Enter would
  // save a half-edited review. The old pill buttons chose their answer on Enter, so Enter
  // still chooses it, through the same onChange, and never submits.
  const chooseOnEnter = (answer: number | null) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    onChange(item.key, answer);
  };

  return (
    <div className="py-4 border-b border-gray-100 last:border-0">
      <div className="mb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <span className="text-xs text-gray-600 font-mono mr-2">{item.code}</span>
            <span id={dimId} className="font-medium text-gray-900">{item.dimension}</span>
            {item.required && <span className="text-red-700 ml-1" aria-hidden="true">*</span>}
            <HelpTooltip help={item.help} dimension={item.dimension} />
          </div>
        </div>
        <p id={textId} className="text-sm text-gray-600 mt-1">{item.text}</p>
      </div>

      <div
        role="radiogroup"
        aria-labelledby={`${dimId} ${textId}`}
        aria-describedby={describedBy}
        className="flex items-center gap-2"
      >
        {[1, 2, 3, 4, 5].map((rating) => (
          <label key={rating} className="relative inline-flex">
            <input
              type="radio"
              name={name}
              value={String(rating)}
              checked={value === rating}
              onChange={() => onChange(item.key, rating)}
              onKeyDown={chooseOnEnter(rating)}
              className="peer sr-only"
            />
            <span
              className={`w-10 h-10 rounded-full text-sm font-medium transition-all ${PILL_A11Y} ${
                value === rating
                  ? rating <= 2
                    ? 'bg-red-600 text-white'
                    : rating === 3
                      ? 'bg-amber-400 text-slate-900'
                      : 'bg-emerald-700 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {rating}
            </span>
          </label>
        ))}
        {item.allowNA && (
          <label className="relative inline-flex">
            <input
              type="radio"
              name={name}
              value="na"
              checked={value === null}
              onChange={() => onChange(item.key, null)}
              onKeyDown={chooseOnEnter(null)}
              className="peer sr-only"
            />
            <span
              className={`px-3 h-10 rounded-full text-sm font-medium transition-all ${PILL_A11Y} ${
                value === null ? 'bg-gray-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              N/A
            </span>
          </label>
        )}
      </div>
    </div>
  );
}

export function RatingScale({ id }: { id?: string }) {
  return (
    <div id={id} className="flex justify-between items-center text-xs text-gray-500 mb-4 px-2">
      <span className="text-red-700 font-medium">1 = Strongly Disagree</span>
      <span className="text-gray-600">3 = Neutral</span>
      <span className="text-emerald-700 font-medium">5 = Strongly Agree</span>
    </div>
  );
}
