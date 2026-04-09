'use client'

import { STATUS_STEPS, getStatusStepIndex } from '@/lib/job-tracker'

interface ProductionProgressBarProps {
  currentStatus: string | null | undefined
  estimatedDelivery?: string | null
  compact?: boolean
}

export function ProductionProgressBar({
  currentStatus,
  estimatedDelivery,
  compact = false,
}: ProductionProgressBarProps) {
  const currentStepIndex = getStatusStepIndex(currentStatus)

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {STATUS_STEPS.map((step, index) => {
            const isCompleted = index <= currentStepIndex
            const isCurrent = index === currentStepIndex

            return (
              <div
                key={step.key}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  isCurrent
                    ? 'bg-[rgb(var(--color-brand-blue))] ring-2 ring-[rgb(var(--color-brand-blue))]/20'
                    : isCompleted
                      ? 'bg-[rgb(var(--color-brand-yellow))]'
                      : 'bg-gray-200'
                }`}
                title={step.tooltip}
              />
            )
          })}
        </div>

        {currentStepIndex >= 0 && (
          <span className="text-xs font-medium text-gray-700">
            {STATUS_STEPS[currentStepIndex].label}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="relative">
        <div className="absolute top-4 left-0 w-full h-0.5 bg-gray-200 rounded-full" />

        <div
          className="absolute top-4 left-0 h-0.5 bg-[rgb(var(--color-brand-blue))] rounded-full transition-all duration-500"
          style={{
            width: `${currentStepIndex >= 0 ? (currentStepIndex / (STATUS_STEPS.length - 1)) * 100 : 0}%`,
          }}
        />

        <div className="relative flex justify-between">
          {STATUS_STEPS.map((step, index) => {
            const isCompleted = index < currentStepIndex
            const isCurrent = index === currentStepIndex

            return (
              <div
                key={step.key}
                className="flex flex-col items-center"
                title={step.tooltip}
              >
                <div
                  className={`glass-step-circle ${
                    isCurrent
                      ? 'glass-step-circle-active'
                      : isCompleted
                        ? 'glass-step-circle-completed'
                        : 'glass-step-circle-pending'
                  }`}
                >
                  {isCompleted ? (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <span className="text-xs font-medium">{index + 1}</span>
                  )}
                </div>

                <span
                  className={`mt-2 text-xs text-center max-w-[60px] transition-colors duration-300 ${
                    isCurrent
                      ? 'font-semibold text-[rgb(var(--color-brand-blue))]'
                      : isCompleted
                        ? 'font-medium text-[rgb(var(--color-brand-blue))]'
                        : 'text-gray-500'
                  }`}
                >
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {estimatedDelivery && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-600">
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span>
            Estimated delivery:{' '}
            <span className="font-medium">
              {new Date(estimatedDelivery).toLocaleDateString('en-NZ', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
