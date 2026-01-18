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

interface Props {
  onPlaceSelect: (place: PlaceDetails) => void;
  placeholder?: string;
  initialValue?: string;
}

// Generate a unique session token for billing optimization
function generateSessionToken(): string {
  return crypto.randomUUID();
}

export default function AddressAutocomplete({
  onPlaceSelect,
  placeholder = "Start typing your address...",
  initialValue = ""
}: Props) {
  const [inputValue, setInputValue] = useState(initialValue);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [sessionToken] = useState(() => generateSessionToken());

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Fetch autocomplete predictions
  const fetchPredictions = useCallback(async (input: string) => {
    if (input.length < 3) {
      setPredictions([]);
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        input,
        sessionToken,
      });

      const response = await fetch(`/api/places/autocomplete?${params}`);
      const data = await response.json();

      setPredictions(data.predictions || []);
      setShowDropdown(true);
    } catch (error) {
      console.error('Autocomplete error:', error);
      setPredictions([]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionToken]);

  // Debounced input handler
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setHighlightedIndex(-1);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchPredictions(value);
    }, 300);
  };

  // Handle place selection
  const handleSelectPrediction = async (prediction: Prediction) => {
    setInputValue(prediction.description);
    setShowDropdown(false);
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

  // Keyboard navigation
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
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < predictions.length) {
          handleSelectPrediction(predictions[highlightedIndex]);
        }
        break;
      case 'Escape':
        setShowDropdown(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
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
          onFocus={() => predictions.length > 0 && setShowDropdown(true)}
          placeholder={placeholder}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent pr-10"
          autoComplete="off"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <svg className="animate-spin h-5 w-5 text-teal-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
  );
}
