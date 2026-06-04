import { useState, useEffect, useRef, useCallback } from 'react';

export interface PlaceDetails {
  placeId: string;
  formattedAddress: string;
  streetAddress: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  latitude: number;
  longitude: number;
}

interface Prediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface DbMatch {
  id: string;
  title: string;
  subtitle: string;
  slug: string;
  reviewCount: number;
}

interface Props {
  onPlaceSelect: (place: PlaceDetails) => void;
  onExistingBuildingSelect?: (buildingId: string, slug: string) => void;
  onManualEntry?: () => void;
  placeholder?: string;
  initialValue?: string;
}

function generateSessionToken(): string {
  return crypto.randomUUID();
}

export default function AddressAutocomplete({
  onPlaceSelect,
  onExistingBuildingSelect,
  onManualEntry,
  placeholder = "Start typing your address...",
  initialValue = ""
}: Props) {
  const [inputValue, setInputValue] = useState(initialValue);
  const [dbMatches, setDbMatches] = useState<DbMatch[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [apiError, setApiError] = useState(false);
  const [sessionToken] = useState(() => generateSessionToken());

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dbDebounceRef = useRef<NodeJS.Timeout>();
  const googleDebounceRef = useRef<NodeJS.Timeout>();

  const totalItems = dbMatches.length + predictions.length;

  // Fast DB search for existing buildings — 150ms
  const fetchDbMatches = useCallback(async (input: string) => {
    if (input.length < 2) {
      setDbMatches([]);
      return;
    }

    try {
      const params = new URLSearchParams({ q: input });
      const response = await fetch(`/api/search/autocomplete?${params}`);
      const data = await response.json();
      // Only show buildings from DB (not landlords) in the review form
      const buildings = (data.results || [])
        .filter((r: any) => r.type === 'building')
        .slice(0, 3)
        .map((r: any) => ({
          id: r.id,
          title: r.title,
          subtitle: r.subtitle,
          slug: r.slug,
          reviewCount: r.reviewCount,
        }));
      setDbMatches(buildings);
    } catch {
      setDbMatches([]);
    }
  }, []);

  // Google Places for structured address data.
  // Min 5 chars + 600ms debounce keeps the request count low so we don't
  // burn the daily Places quota on incidental typing (a user typing "100 B"
  // shouldn't trigger Google; "100 Beacon" should).
  const fetchPredictions = useCallback(async (input: string) => {
    if (input.length < 5) {
      setPredictions([]);
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams({ input, sessionToken });
      const response = await fetch(`/api/places/autocomplete?${params}`);
      const data = await response.json();
      if (!response.ok || data.error) {
        setPredictions([]);
        setApiError(true);
      } else {
        setPredictions(data.predictions || []);
        setApiError(false);
      }
      setShowDropdown(true);
    } catch {
      setPredictions([]);
      setApiError(true);
    } finally {
      setIsLoading(false);
    }
  }, [sessionToken]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setHighlightedIndex(-1);

    if (dbDebounceRef.current) clearTimeout(dbDebounceRef.current);
    if (googleDebounceRef.current) clearTimeout(googleDebounceRef.current);

    if (!value.trim()) {
      setDbMatches([]);
      setPredictions([]);
      setShowDropdown(false);
      setApiError(false);
      return;
    }

    // DB first — fast, 150ms
    dbDebounceRef.current = setTimeout(() => {
      fetchDbMatches(value);
      setShowDropdown(true);
    }, 150);

    // Google Places — 600ms (longer debounce reduces request count;
    // fires only at 5+ chars per fetchPredictions guard above)
    googleDebounceRef.current = setTimeout(() => fetchPredictions(value), 600);
  };

  const handleSelectDbMatch = (match: DbMatch) => {
    setInputValue(match.title);
    setShowDropdown(false);
    setDbMatches([]);
    setPredictions([]);

    if (onExistingBuildingSelect) {
      onExistingBuildingSelect(match.id, match.slug);
    }
  };

  const handleSelectPrediction = async (prediction: Prediction) => {
    setInputValue(prediction.description);
    setShowDropdown(false);
    setDbMatches([]);
    setPredictions([]);
    setIsLoading(true);

    try {
      const params = new URLSearchParams({
        placeId: prediction.placeId,
        sessionToken,
      });
      const response = await fetch(`/api/places/details?${params}`);
      const data = await response.json();
      if (data.place) {
        onPlaceSelect(data.place);
      }
    } catch (error) {
      console.error('Place details error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || totalItems === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => prev < totalItems - 1 ? prev + 1 : 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => prev > 0 ? prev - 1 : totalItems - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < totalItems) {
          if (highlightedIndex < dbMatches.length) {
            handleSelectDbMatch(dbMatches[highlightedIndex]);
          } else {
            handleSelectPrediction(predictions[highlightedIndex - dbMatches.length]);
          }
        }
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
    return () => {
      if (dbDebounceRef.current) clearTimeout(dbDebounceRef.current);
      if (googleDebounceRef.current) clearTimeout(googleDebounceRef.current);
    };
  }, []);

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => totalItems > 0 && setShowDropdown(true)}
          placeholder={placeholder}
          className="w-full px-4 py-3 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500 focus:border-transparent pr-10"
          autoComplete="off"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <svg className="animate-spin h-5 w-5 text-teal-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        )}
        {!isLoading && inputValue && (
          <button
            type="button"
            onClick={() => {
              setInputValue('');
              setDbMatches([]);
              setPredictions([]);
              setShowDropdown(false);
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {showDropdown && (totalItems > 0 || apiError || (onManualEntry && inputValue.length >= 3)) && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto"
        >
          {apiError && (
            <div className="px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
              Address search is temporarily unavailable. You can still enter your address manually below.
            </div>
          )}

          {/* Existing buildings from our DB */}
          {dbMatches.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border-b border-teal-100">
                Existing properties
              </div>
              {dbMatches.map((match, index) => (
                <button
                  key={`db-${match.id}`}
                  type="button"
                  onClick={() => handleSelectDbMatch(match)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                    highlightedIndex === index ? 'bg-teal-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 truncate">{match.title}</div>
                      <div className="text-sm text-gray-500 truncate">{match.subtitle}</div>
                    </div>
                    {match.reviewCount > 0 && (
                      <span className="flex-shrink-0 text-xs text-teal-700 font-medium">
                        {match.reviewCount} review{match.reviewCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </>
          )}

          {/* Google Places results */}
          {predictions.length > 0 && (
            <>
              {dbMatches.length > 0 && (
                <div className="px-4 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-100">
                  Other addresses
                </div>
              )}
              {predictions.map((prediction, index) => {
                const itemIndex = dbMatches.length + index;
                return (
                  <button
                    key={prediction.placeId}
                    type="button"
                    onClick={() => handleSelectPrediction(prediction)}
                    onMouseEnter={() => setHighlightedIndex(itemIndex)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 transition-colors ${
                      highlightedIndex === itemIndex ? 'bg-teal-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-medium text-gray-900 truncate">{prediction.mainText}</div>
                    <div className="text-sm text-gray-500 truncate">{prediction.secondaryText}</div>
                  </button>
                );
              })}
            </>
          )}

          {onManualEntry && inputValue.length >= 3 && (
            <button
              type="button"
              onClick={() => {
                setShowDropdown(false);
                onManualEntry();
              }}
              className="w-full text-left px-4 py-3 border-t border-gray-100 text-sm font-medium text-teal-700 hover:bg-teal-50 transition-colors"
            >
              Can't find your address? Enter it manually
            </button>
          )}

          {predictions.length > 0 && (
            <div className="px-4 py-2 text-xs text-gray-400 bg-gray-50 flex items-center gap-1">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
              </svg>
              Powered by Google
            </div>
          )}
        </div>
      )}
    </div>
  );
}
