import { useState, useEffect, useRef, useCallback, useId, useMemo } from 'react';
import { keepInputFocus, popupMayOpen, useComboboxListbox } from './ui/useComboboxListbox';

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
  /**
   * Required: an "Existing properties" row the reader can click must go somewhere. It was
   * optional, the review form never passed it, and the click did nothing for months.
   */
  onExistingBuildingSelect: (buildingId: string, slug: string) => void;
  onManualEntry?: () => void;
  placeholder?: string;
  initialValue?: string;
  /** The input's id, so a visible label's htmlFor names the combobox. */
  inputId?: string;
  /** The visible label's id. It names the listbox. */
  labelledBy?: string;
  /** The id of the help text under the input. */
  describedBy?: string;
}

/** Shown in the popup, and said by the status region, when the Google lookup fails. */
const API_ERROR_TEXT = 'Address search is temporarily unavailable. You can still enter your address manually below.';

/** Keyboard order: our buildings, then Google addresses, then manual entry. */
type AddressOption =
  | { kind: 'existing'; match: DbMatch }
  | { kind: 'prediction'; prediction: Prediction }
  | { kind: 'manual' };

/** The keyboard-active option: today's tint, plus an inset outline that does not rely on the tint. */
const ACTIVE_OPTION_CLASS = 'bg-teal-50 outline-2 -outline-offset-2 outline-teal-700';

function generateSessionToken(): string {
  return crypto.randomUUID();
}

export default function AddressAutocomplete({
  onPlaceSelect,
  onExistingBuildingSelect,
  onManualEntry,
  placeholder = "Start typing your address...",
  initialValue = "",
  inputId,
  labelledBy,
  describedBy,
}: Props) {
  const [inputValue, setInputValue] = useState(initialValue);
  const [dbMatches, setDbMatches] = useState<DbMatch[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // The database lookup shows no spinner, but the status region waits for it too.
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [apiError, setApiError] = useState(false);
  const [sessionToken] = useState(() => generateSessionToken());
  const existingHeaderId = useId();
  const otherHeaderId = useId();

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dbDebounceRef = useRef<NodeJS.Timeout>();
  const googleDebounceRef = useRef<NodeJS.Timeout>();
  // The text the newest lookup is for. A response for older text (typed over, cleared, or
  // replaced by a pick) is dropped, so it cannot bring back suggestions for that text.
  const queryRef = useRef(initialValue);
  // Tab can land on Clear address while a lookup runs. The spinner takes the button's place
  // only while the button is not focused, so a lookup never unmounts the focused control.
  const [clearFocused, setClearFocused] = useState(false);

  const totalItems = dbMatches.length + predictions.length;
  const showManual = Boolean(onManualEntry) && inputValue.length >= 3;
  const options = useMemo<AddressOption[]>(
    () => [
      ...dbMatches.map((match): AddressOption => ({ kind: 'existing', match })),
      ...predictions.map((prediction): AddressOption => ({ kind: 'prediction', prediction })),
      ...(showManual ? [{ kind: 'manual' } as const] : []),
    ],
    [dbMatches, predictions, showManual],
  );
  const popupOpen = showDropdown && (options.length > 0 || apiError);
  // New typing or new results restart the status region's settle timer.
  const statusVersion = useMemo(() => ({ inputValue, options }), [inputValue, options]);

  // Fast DB search for existing buildings, 150ms
  const fetchDbMatches = useCallback(async (input: string) => {
    if (input.length < 2) {
      setDbMatches([]);
      return;
    }

    setIsLoadingDb(true);
    try {
      const params = new URLSearchParams({ q: input });
      const response = await fetch(`/api/search/autocomplete?${params}`);
      const data = await response.json();
      if (input !== queryRef.current) return;
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
    } finally {
      setIsLoadingDb(false);
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
      if (input !== queryRef.current) return;
      if (!response.ok || data.error) {
        setPredictions([]);
        setApiError(true);
      } else {
        setPredictions(data.predictions || []);
        setApiError(false);
      }
      if (popupMayOpen(inputRef.current)) setShowDropdown(true);
    } catch {
      setPredictions([]);
      setApiError(true);
    } finally {
      setIsLoading(false);
    }
  }, [sessionToken]);

  const clearPendingSearches = () => {
    if (dbDebounceRef.current) clearTimeout(dbDebounceRef.current);
    if (googleDebounceRef.current) clearTimeout(googleDebounceRef.current);
  };

  /** The clear button and Escape on a closed popup: empty the box and every result. */
  const clearInput = () => {
    clearPendingSearches();
    queryRef.current = '';
    setInputValue('');
    setDbMatches([]);
    setPredictions([]);
    setShowDropdown(false);
    setApiError(false);
  };

  const handleSelectDbMatch = (match: DbMatch) => {
    queryRef.current = match.title;
    setInputValue(match.title);
    setShowDropdown(false);
    setDbMatches([]);
    setPredictions([]);

    onExistingBuildingSelect(match.id, match.slug);
  };

  const handleSelectPrediction = async (prediction: Prediction) => {
    queryRef.current = prediction.description;
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

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (option.kind === 'existing') {
      handleSelectDbMatch(option.match);
    } else if (option.kind === 'prediction') {
      handleSelectPrediction(option.prediction);
    } else {
      setShowDropdown(false);
      onManualEntry?.();
    }
  };

  const combobox = useComboboxListbox({
    count: options.length,
    open: popupOpen,
    onOpenChange: setShowDropdown,
    onSelect: selectOption,
    onClear: clearInput,
    hasText: inputValue.length > 0,
    listboxLabelledBy: labelledBy,
    status: {
      active: showDropdown && inputValue.trim().length > 0,
      // The manual-entry option is a way out, not a result.
      results: totalItems,
      loading: isLoading || isLoadingDb,
      message: apiError ? API_ERROR_TEXT : null,
      version: statusVersion,
    },
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    queryRef.current = value;
    setInputValue(value);
    combobox.setActiveIndex(-1);

    clearPendingSearches();

    if (!value.trim()) {
      setDbMatches([]);
      setPredictions([]);
      setShowDropdown(false);
      setApiError(false);
      return;
    }

    // DB first: fast, 150ms
    dbDebounceRef.current = setTimeout(() => {
      fetchDbMatches(value);
      if (popupMayOpen(inputRef.current)) setShowDropdown(true);
    }, 150);

    // Google Places: 600ms (longer debounce reduces request count;
    // fires only at 5+ chars per fetchPredictions guard above)
    googleDebounceRef.current = setTimeout(() => fetchPredictions(value), 600);
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

  const predictionOptions = predictions.map((prediction, index) => {
    const optionIndex = dbMatches.length + index;
    return (
      <div
        key={prediction.placeId}
        {...combobox.getOptionProps(optionIndex)}
        className={`w-full text-left px-4 py-3 border-b border-gray-100 cursor-default transition-colors ${
          combobox.activeIndex === optionIndex ? ACTIVE_OPTION_CLASS : 'hover:bg-gray-50'
        }`}
      >
        <div className="font-medium text-gray-900 truncate">{prediction.mainText}</div>
        <div className="text-sm text-gray-500 truncate">{prediction.secondaryText}</div>
      </div>
    );
  });
  const manualIndex = options.length - 1;
  const showSpinner = isLoading && !clearFocused;

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            setClearFocused(false);
            if (totalItems > 0) setShowDropdown(true);
          }}
          {...combobox.inputProps}
          aria-describedby={describedBy}
          placeholder={placeholder}
          className="w-full px-4 py-3 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-700 focus:border-transparent pr-10"
          autoComplete="off"
        />
        {showSpinner && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <svg aria-hidden="true" className="animate-spin h-5 w-5 text-teal-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        )}
        {!showSpinner && inputValue && (
          <button
            type="button"
            aria-label="Clear address"
            onFocus={() => setClearFocused(true)}
            onBlur={() => setClearFocused(false)}
            onClick={() => {
              clearInput();
              combobox.setActiveIndex(-1);
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-600"
          >
            <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {popupOpen && (
        // The popup's own mouse presses keep focus in the input, so a click on a header, the
        // attribution or the scrollbar does not close it. Only the listbox scrolls: a scrolling
        // wrapper with no focusable content would be its own Tab stop.
        <div
          ref={dropdownRef}
          onMouseDown={keepInputFocus}
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 flex flex-col overflow-hidden"
        >
          {apiError && (
            <div className="shrink-0 px-4 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">
              {API_ERROR_TEXT}
            </div>
          )}

          {options.length > 0 && (
            <div {...combobox.listboxProps} className="min-h-0 overflow-y-auto">
              {/* Existing buildings from our DB */}
              {dbMatches.length > 0 && (
                <div role="group" aria-labelledby={existingHeaderId}>
                  <div
                    id={existingHeaderId}
                    role="presentation"
                    className="px-4 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border-b border-teal-100"
                  >
                    Existing properties
                  </div>
                  {dbMatches.map((match, index) => (
                    <div
                      key={`db-${match.id}`}
                      {...combobox.getOptionProps(index)}
                      className={`w-full text-left px-4 py-3 border-b border-gray-100 cursor-default transition-colors ${
                        combobox.activeIndex === index ? ACTIVE_OPTION_CLASS : 'hover:bg-gray-50'
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
                    </div>
                  ))}
                </div>
              )}

              {/* Google Places results, grouped only when our own rows are above them */}
              {predictions.length > 0 &&
                (dbMatches.length > 0 ? (
                  <div role="group" aria-labelledby={otherHeaderId}>
                    <div
                      id={otherHeaderId}
                      role="presentation"
                      className="px-4 py-1.5 text-xs font-medium text-gray-500 bg-gray-50 border-b border-gray-100"
                    >
                      Other addresses
                    </div>
                    {predictionOptions}
                  </div>
                ) : (
                  predictionOptions
                ))}

              {showManual && (
                <div
                  {...combobox.getOptionProps(manualIndex)}
                  className={`w-full text-left px-4 py-3 border-t border-gray-100 text-sm font-medium text-teal-700 hover:bg-teal-50 cursor-default transition-colors ${
                    combobox.activeIndex === manualIndex ? ACTIVE_OPTION_CLASS : ''
                  }`}
                >
                  Can't find your address? Enter it manually
                </div>
              )}
            </div>
          )}

          {predictions.length > 0 && (
            <div className="shrink-0 px-4 py-2 text-xs text-gray-600 bg-gray-50 flex items-center gap-1">
              <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
              </svg>
              Powered by Google
            </div>
          )}
        </div>
      )}

      {/* Result counts and the lookup error, read once results settle (P4). */}
      <div role="status" aria-live="polite" className="sr-only">
        {combobox.statusText}
      </div>
    </div>
  );
}
