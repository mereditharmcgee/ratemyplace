import { useState, useEffect, useRef, useCallback } from 'react';

interface Prediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

function generateSessionToken(): string {
  return crypto.randomUUID();
}

export default function HomeSearch() {
  const [inputValue, setInputValue] = useState('');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [sessionToken] = useState(() => generateSessionToken());

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  const fetchPredictions = useCallback(async (input: string) => {
    if (input.length < 3) {
      setPredictions([]);
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams({ input, sessionToken });
      const response = await fetch(`/api/places/autocomplete?${params}`);
      const data = await response.json();
      setPredictions(data.predictions || []);
      setShowDropdown(true);
    } catch {
      setPredictions([]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionToken]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setHighlightedIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(value), 300);
  };

  const handleSelectPrediction = async (prediction: Prediction) => {
    setInputValue(prediction.description);
    setShowDropdown(false);
    setPredictions([]);
    setIsLoading(true);

    try {
      // Check if this building already exists in our DB
      const params = new URLSearchParams({ placeId: prediction.placeId });
      const response = await fetch(`/api/buildings?${params}`);
      const data = await response.json();

      if (data.building?.slug) {
        // Building exists — go directly to its page
        window.location.href = `/building/${data.building.slug}`;
        return;
      }
    } catch {
      // Fall through to search
    }

    // Building not in DB — go to search results
    window.location.href = `/search?q=${encodeURIComponent(prediction.mainText)}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (highlightedIndex >= 0 && highlightedIndex < predictions.length) {
      handleSelectPrediction(predictions[highlightedIndex]);
    } else if (inputValue.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(inputValue.trim())}`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || predictions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev =>
          prev < predictions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev =>
          prev > 0 ? prev - 1 : predictions.length - 1
        );
        break;
      case 'Escape':
        setShowDropdown(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => predictions.length > 0 && setShowDropdown(true)}
            placeholder="Search by address, neighborhood, or landlord..."
            className="w-full px-6 py-4 rounded-lg bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-teal-300"
            autoComplete="off"
          />
          {isLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg className="animate-spin h-5 w-5 text-teal-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          )}

          {showDropdown && predictions.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
            >
              {predictions.map((prediction, index) => (
                <button
                  key={prediction.placeId}
                  type="button"
                  onClick={() => handleSelectPrediction(prediction)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 transition-colors ${
                    highlightedIndex === index ? 'bg-teal-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="font-medium text-gray-900">{prediction.mainText}</div>
                  <div className="text-sm text-gray-500">{prediction.secondaryText}</div>
                </button>
              ))}
              <div className="px-4 py-2 text-xs text-gray-400 bg-gray-50 flex items-center gap-1">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
                Powered by Google
              </div>
            </div>
          )}
        </div>

        <button
          type="submit"
          className="px-8 py-4 bg-amber-500 text-slate-900 font-semibold rounded-lg hover:bg-amber-400 transition-colors"
        >
          Search
        </button>
      </div>
    </form>
  );
}
