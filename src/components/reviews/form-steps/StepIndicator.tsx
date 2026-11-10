import { STEPS, type Step } from './types';

interface Props {
  currentStep: Step;
}

export default function StepIndicator({ currentStep }: Props) {
  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep);
  const stepNumber = currentStepIndex + 1;
  const totalSteps = STEPS.length;
  const currentTitle = STEPS[currentStepIndex]?.title ?? '';
  const progressPercent = (stepNumber / totalSteps) * 100;

  return (
    <div className="mb-8">
      {/* Compact indicator below `lg` — the circle row needs ~420px and clips at 375px */}
      <div className="lg:hidden">
        <p className="text-sm text-gray-600 mb-2">
          Step {stepNumber} of {totalSteps} · {currentTitle}
        </p>
        <div className="w-full h-1 bg-gray-200 rounded">
          <div
            className="h-1 bg-teal-700 rounded"
            style={{ width: `${progressPercent}%` }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={totalSteps}
            aria-valuenow={stepNumber}
            aria-valuetext={`Step ${stepNumber} of ${totalSteps}`}
            aria-label="Review progress"
          />
        </div>
      </div>

      {/* Full circle row from `lg` up. Each title sits under its circle, so seven equal columns
          fit the 704px form column; titles beside the circles ran past it at 1024 to 1440. */}
      <ol aria-label="Review progress" className="hidden lg:flex items-start">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            className="relative flex-1 flex flex-col items-center text-center"
            aria-current={i === currentStepIndex ? 'step' : undefined}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
                i <= currentStepIndex ? 'bg-teal-700 text-white' : 'bg-gray-200 text-gray-600'
              }`}
            >
              {i + 1}
            </div>
            <span className="mt-1 text-xs text-gray-600">{s.title}</span>
            {i < STEPS.length - 1 && (
              // From 4px past this circle to 4px before the next one, level with their centers.
              <span
                aria-hidden="true"
                className={`absolute top-3.5 left-[calc(50%+1.25rem)] right-[calc(-50%+1.25rem)] h-1 ${
                  i < currentStepIndex ? 'bg-teal-600' : 'bg-gray-200'
                }`}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
