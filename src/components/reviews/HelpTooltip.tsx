import { useState, useRef, useEffect, useId } from 'react';
import type { SurveyItemHelp } from '../../lib/surveyItems';

interface HelpTooltipProps {
  help: SurveyItemHelp;
  dimension: string;
}

/** Space kept between the open panel and the edge of the screen, in px. */
const EDGE_GAP = 16;
/** The arrow's resting offset from the panel's left edge (left-3), in px. */
const ARROW_LEFT = 12;

/**
 * The help for one rating question. A disclosure (APG disclosure pattern), not a tooltip:
 * the button shows and hides a panel of text, Escape and Close put focus back on the
 * button, and a press outside closes it.
 */
export function HelpTooltip({ help, dimension }: HelpTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  // How far the panel moves left so it ends inside the screen, in px.
  const [shift, setShift] = useState(0);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = (returnFocus: boolean) => {
    setIsOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const toggle = () => {
    setShift(0);
    setIsOpen(!isOpen);
  };

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on Escape key. Focus goes back to the button when it was on the button or in the
  // panel; a reader who has moved on elsewhere stays where they are.
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        const active = document.activeElement;
        const wasHere =
          !active ||
          active === document.body ||
          buttonRef.current === active ||
          Boolean(tooltipRef.current?.contains(active));
        close(wasHere);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  // The panel starts at the button. Next to a long question on a phone it would run past
  // the right edge and make the page scroll sideways, so it moves left to fit.
  useEffect(() => {
    if (!isOpen || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    const viewport = document.documentElement.clientWidth || window.innerWidth;
    const overflow = rect.right - (viewport - EDGE_GAP);
    if (overflow > 0) setShift(Math.max(0, Math.min(overflow, rect.left - EDGE_GAP)));
  }, [isOpen]);

  return (
    <div className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="ml-0.5 -m-1 p-1 rounded-sm text-gray-500 hover:text-teal-700 focus:text-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 transition-colors"
        aria-label={`Help for ${dimension}`}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={tooltipRef}
          id={panelId}
          className="absolute z-50 left-0 top-full mt-2 w-80 sm:w-96 max-w-[calc(100vw-2rem)] bg-white rounded-lg shadow-lg border border-gray-200 p-4 text-sm"
          style={shift > 0 ? { left: -shift } : undefined}
        >
          {/* Arrow */}
          <div
            className="absolute -top-2 left-3 w-3 h-3 bg-white border-l border-t border-gray-200 transform rotate-45"
            style={shift > 0 ? { left: ARROW_LEFT + shift } : undefined}
          />

          {/* Header */}
          <div className="flex justify-between items-start mb-3">
            <h4 className="font-semibold text-gray-900">{dimension}</h4>
            <button
              type="button"
              onClick={() => close(true)}
              className="text-gray-500 hover:text-gray-600"
              aria-label="Close help"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Description */}
          <p className="text-gray-600 mb-4">{help.description}</p>

          {/* Examples */}
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">5</span>
              <p className="text-gray-600 text-xs">{help.examples.high}</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-yellow-100 text-yellow-700 flex items-center justify-center text-xs font-bold">3</span>
              <p className="text-gray-600 text-xs">{help.examples.mid}</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold">1</span>
              <p className="text-gray-600 text-xs">{help.examples.low}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
