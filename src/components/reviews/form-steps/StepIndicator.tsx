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
            aria-valuemin={1}
            aria-valuemax={totalSteps}
            aria-valuenow={stepNumber}
            aria-label="Review progress"
          />
        </div>
      </div>

      {/* Full circle row from `lg` up */}
      <div className="hidden lg:flex items-center justify-between">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center" title={s.title}>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
                i <= currentStepIndex ? 'bg-teal-700 text-white' : 'bg-gray-200 text-gray-500'
              }`}
            >
              {i + 1}
            </div>
            <span className="ml-2 text-sm text-gray-600 whitespace-nowrap">{s.title}</span>
            {i < STEPS.length - 1 && (
              <div className={`w-12 h-1 mx-2 shrink-0 ${i < currentStepIndex ? 'bg-teal-600' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
