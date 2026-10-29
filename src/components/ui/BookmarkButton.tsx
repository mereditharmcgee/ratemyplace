import { useEffect, useRef, useState } from 'react';

interface Props {
  buildingId: string;
  initialSaved: boolean;
}

export default function BookmarkButton({ buildingId, initialSaved }: Props) {
  const [saved, setSaved] = useState(initialSaved);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasLoading = useRef(false);

  // The button disables itself during the request, which drops focus to the page. When it
  // is enabled again, focus goes back to it if nothing else has taken it.
  useEffect(() => {
    if (wasLoading.current && !loading) {
      const active = document.activeElement;
      if (!active || active === document.body) buttonRef.current?.focus();
    }
    wasLoading.current = loading;
  }, [loading]);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2000);
  };

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);

    try {
      const method = saved ? 'DELETE' : 'POST';
      const response = await fetch(`/api/buildings/${buildingId}/save`, {
        method,
        credentials: 'same-origin'
      });

      if (response.ok) {
        const newSaved = !saved;
        setSaved(newSaved);
        showToast(newSaved ? 'Building saved' : 'Removed from saved');
      } else {
        showToast('Something went wrong');
      }
    } catch {
      showToast('Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative inline-flex flex-col items-center">
      <button
        ref={buttonRef}
        onClick={handleClick}
        disabled={loading}
        aria-label={saved ? 'Remove from saved buildings' : 'Save building'}
        title={saved ? 'Remove from saved' : 'Save building'}
        className={`p-2 rounded-[6px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          saved
            ? 'text-teal-700 hover:text-teal-700 hover:bg-teal-50'
            : 'text-gray-500 hover:text-gray-600 hover:bg-gray-100'
        }`}
      >
        <svg
          className="w-6 h-6"
          fill={saved ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth={saved ? 0 : 2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
          />
        </svg>
      </button>

      {/* Always present, so the toast is announced when it appears. The region takes the
          old pill's position, so the pill sits centered under the button as before. */}
      <div role="status" className="absolute top-full mt-2 z-50">
        {toast && (
          <div className="whitespace-nowrap bg-gray-900 text-white text-sm px-3 py-1.5 rounded-lg shadow-lg">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
