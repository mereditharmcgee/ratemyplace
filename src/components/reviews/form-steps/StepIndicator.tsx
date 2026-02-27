import { STEPS, type Step } from './types';

interface Props {
  currentStep: Step;
}

export default function StepIndicator({ currentStep }: Props) {
  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className="flex items-center justify-between mb-8 overflow-x-auto">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
              i <= currentStepIndex ? 'bg-teal-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}
          >
            {i + 1}
          </div>
          <span className="hidden sm:block ml-2 text-sm text-gray-600 whitespace-nowrap">{s.title}</span>
          {i < STEPS.length - 1 && (
            <div className={`w-4 sm:w-12 h-1 mx-2 ${i < currentStepIndex ? 'bg-teal-600' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}
