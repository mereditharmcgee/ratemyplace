import { REVIEW_FLAG_CODES, REVIEW_FLAG_LABELS, REVIEW_FLAGS_LIST_LABEL, isReviewFlagCode } from '../../lib/reviewFlags';

// One admin review row's moderation signals: advisory text badges, one per known code, in code
// order. Text, not colour alone, carries each one. Unknown values are dropped, and a row with
// none renders nothing. The codes come from GET /api/admin/reviews (src/lib/reviewFlags.ts).

interface Props {
  flags?: readonly unknown[];
}

export default function ReviewFlags({ flags }: Props) {
  const present = new Set(Array.isArray(flags) ? flags.filter(isReviewFlagCode) : []);
  const shown = REVIEW_FLAG_CODES.filter((code) => present.has(code));
  if (shown.length === 0) return null;
  return (
    <ul aria-label={REVIEW_FLAGS_LIST_LABEL} className="mt-1 flex flex-wrap gap-1">
      {shown.map((code) => (
        <li key={code} className="inline-block px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-800 rounded-full">
          {REVIEW_FLAG_LABELS[code]}
        </li>
      ))}
    </ul>
  );
}
