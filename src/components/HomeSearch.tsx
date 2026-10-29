import { useState, useEffect, useRef, useCallback, useId, useMemo } from 'react';
import { getScoreBgTint, getScoreTextColor } from '../lib/scoring-colors';
import { getNamedPartyScoreState, NAMED_PARTY_MIN_REVIEWS } from '../lib/scoring';
import { earlyScoreMarkerClass, isEarlyRating, scoreNumberClass } from '../lib/earlyRating';
import { browserNav, existingBuildingReviewPath } from '../lib/reviewPaths';
import {
  homeDropdownItems,
  homeItemHref,
  placeReviewHref,
  type HomeDbResult,
  type HomeDropdownItem,
  type HomePrediction,
  type HomeReviewTarget,
} from '../lib/homeSearchItems';
import { keepInputFocus, popupMayOpen, useComboboxListbox } from './ui/useComboboxListbox';

const SEARCH_LABEL = 'Search by address, neighborhood, or landlord';

/** The keyboard-active option: an inset outline that does not rely on the row's tint. */
const ACTIVE_OUTLINE_CLASS = 'outline-2 -outline-offset-2 outline-teal-700';

type BuildingItem = Extract<HomeDropdownItem, { kind: 'building' }>;

/**
 * The listbox's options in keyboard order. A building row is two options: opening its page,
 * then writing a review for it (an option cannot hold a link). Landlord and address rows are one.
 */
type HomeOption = { kind: 'open'; item: HomeDropdownItem } | { kind: 'review'; item: BuildingItem };

interface HomeRow {
  item: HomeDropdownItem;
  openIndex: number;
  /** The review option's index, for a building row. */
  reviewIndex: number | null;
}

function generateSessionToken(): string {
  return crypto.randomUUID();
}

function reviewHref(target: HomeReviewTarget): string {
  return 'buildingId' in target ? existingBuildingReviewPath(target.buildingId) : placeReviewHref(target.placeId);
}

function optionHref(option: HomeOption): string {
  return option.kind === 'review' ? reviewHref(option.item.review) : homeItemHref(option.item);
}

export default function HomeSearch() {
  const [inputValue, setInputValue] = useState('');
  const [dbResults, setDbResults] = useState<HomeDbResult[]>([]);
  const [googleResults, setGoogleResults] = useState<HomePrediction[]>([]);
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [sessionToken] = useState(() => generateSessionToken());
  const baseId = useId();

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dbDebounceRef = useRef<NodeJS.Timeout>();
  // The text the newest lookup is for. A response for older text (typed over or cleared) is
  // dropped, so it cannot bring back suggestions for that text.
  const queryRef = useRef('');

  // Buildings already on RateMyPlace first (ours, then Google suggestions the server matched
  // to a building page), then landlords, then other addresses. See homeSearchItems.ts.
  const items: HomeDropdownItem[] = useMemo(() => homeDropdownItems(dbResults, googleResults), [dbResults, googleResults]);
  const { options, rows } = useMemo(() => {
    const flat: HomeOption[] = [];
    const byRow: HomeRow[] = items.map((item) => {
      const openIndex = flat.push({ kind: 'open', item }) - 1;
      const reviewIndex = item.kind === 'building' ? flat.push({ kind: 'review', item }) - 1 : null;
      return { item, openIndex, reviewIndex };
    });
    return { options: flat, rows: byRow };
  }, [items]);
  const popupOpen = showDropdown && options.length > 0;
  // New typing or new results restart the status region's settle timer.
  const statusVersion = useMemo(() => ({ inputValue, items }), [inputValue, items]);

  const fetchGoogleResults = useCallback(async (input: string) => {
    if (input.length < 3) {
      setGoogleResults([]);
      return;
    }
    setIsLoadingGoogle(true);
    try {
      // scope=boston: biased to Boston, matched to our buildings, Massachusetts only except a
      // building we already have. The review form's address search does not send it and
      // keeps any US address.
      const params = new URLSearchParams({ input, sessionToken, scope: 'boston' });
      const response = await fetch(`/api/places/autocomplete?${params}`);
      const data = await response.json();
      if (input !== queryRef.current) return;
      setGoogleResults(data.predictions || []);
      if (popupMayOpen(inputRef.current)) setShowDropdown(true);
    } catch {
      setGoogleResults([]);
    } finally {
      setIsLoadingGoogle(false);
    }
  }, [sessionToken]);

  // DB-first search. Google fires only when DB returns few results, so we
  // don't burn Google quota on common-address queries that we can answer
  // from our own data.
  const fetchDbResults = useCallback(async (input: string) => {
    if (input.length < 2) {
      setDbResults([]);
      return;
    }
    setIsLoadingDb(true);
    try {
      const params = new URLSearchParams({ q: input });
      const response = await fetch(`/api/search/autocomplete?${params}`);
      const data = await response.json();
      if (input !== queryRef.current) return;
      const results = data.results || [];
      setDbResults(results);
      if (popupMayOpen(inputRef.current)) setShowDropdown(true);
      if (results.length < 3 && input.length >= 3) {
        fetchGoogleResults(input);
      } else {
        setGoogleResults([]);
      }
    } catch {
      setDbResults([]);
      if (input.length >= 3) fetchGoogleResults(input);
    } finally {
      setIsLoadingDb(false);
    }
  }, [fetchGoogleResults]);

  /** Escape on a closed popup: HomeSearch's way to clear, with no extra visible button. */
  const clearInput = () => {
    if (dbDebounceRef.current) clearTimeout(dbDebounceRef.current);
    queryRef.current = '';
    setInputValue('');
    setDbResults([]);
    setGoogleResults([]);
    setShowDropdown(false);
  };

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option) return;
    setShowDropdown(false);
    setDbResults([]);
    setGoogleResults([]);
    // A building opens its page, a landlord its page. An address we have no page for hands
    // off to /review/new with the placeId, which still opens the building at unit details
    // if it turns out we have it, otherwise the address step pre-filled for one Continue.
    browserNav.go(optionHref(option));
  };

  const isLoading = isLoadingDb || isLoadingGoogle;

  const combobox = useComboboxListbox({
    count: options.length,
    open: popupOpen,
    onOpenChange: setShowDropdown,
    onSelect: selectOption,
    onClear: clearInput,
    hasText: inputValue.length > 0,
    listboxLabel: SEARCH_LABEL,
    status: {
      active: showDropdown && inputValue.trim().length > 0,
      // Rows, not options: a building's review option is an action on a result, not another one.
      results: items.length,
      loading: isLoading,
      version: statusVersion,
    },
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    queryRef.current = value;
    setInputValue(value);
    combobox.setActiveIndex(-1);

    if (dbDebounceRef.current) clearTimeout(dbDebounceRef.current);

    if (!value.trim()) {
      setDbResults([]);
      setGoogleResults([]);
      setShowDropdown(false);
      return;
    }

    dbDebounceRef.current = setTimeout(() => fetchDbResults(value), 150);
  };

  // Enter on an active option is handled by the combobox and never reaches here. Enter with
  // no option active, or the Search button, searches for the text.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      browserNav.go(`/search?q=${encodeURIComponent(inputValue.trim())}`);
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
    return () => { if (dbDebounceRef.current) clearTimeout(dbDebounceRef.current); };
  }, []);

  const ownRows = rows.filter((row) => row.item.kind !== 'address');
  const addressRows = rows.filter((row) => row.item.kind === 'address');
  const ownHeaderId = `${baseId}-own`;
  const otherHeaderId = `${baseId}-other`;

  const renderRow = (row: HomeRow, rowIndex: number) => {
    const { item, openIndex, reviewIndex } = row;
    const openActive = combobox.activeIndex === openIndex;

    if (item.kind === 'building' && reviewIndex !== null) {
      const score = item.avgScore;
      const reviewActive = combobox.activeIndex === reviewIndex;
      const titleId = `${baseId}-title-${rowIndex}`;
      const reviewTextId = `${baseId}-review-${rowIndex}`;
      return (
        <div
          key={item.key}
          role="none"
          className={`relative border-b border-gray-100 transition-colors ${
            openActive || reviewActive ? 'bg-teal-50' : 'hover:bg-gray-50'
          }`}
        >
          <div
            {...combobox.getOptionProps(openIndex)}
            className={`w-full text-left px-4 pt-3 pb-2 cursor-default ${openActive ? ACTIVE_OUTLINE_CLASS : ''}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div id={titleId} className="font-medium text-gray-900 truncate">{item.title}</div>
                <div className="text-sm text-gray-500 truncate">{item.subtitle}</div>
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                {score !== null && (
                  // Under the threshold the number is muted gray with a band dot,
                  // as on the building page it opens (lib/earlyRating.ts).
                  <span
                    data-home-score
                    className={`text-xs px-1.5 py-0.5 rounded ${getScoreBgTint(score)} ${
                      isEarlyRating(item.reviewCount) ? 'inline-flex items-center gap-1 ' : ''
                    }${scoreNumberClass(score, item.reviewCount)}`}
                  >
                    {isEarlyRating(item.reviewCount) && (
                      <span aria-hidden="true" data-early-score-marker className={earlyScoreMarkerClass(score)} />
                    )}
                    {score.toFixed(1)}
                  </span>
                )}
                {item.reviewCount > 0 && (
                  <span className="text-xs text-gray-500">
                    {item.reviewCount} review{item.reviewCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
            <span className="inline-block mt-1 py-1 text-xs font-medium text-teal-700">
              See this building <span aria-hidden="true">→</span>
            </span>
          </div>
          {/* Its own option, placed where the link was; named "Write a review" plus the building. */}
          <div
            {...combobox.getOptionProps(reviewIndex)}
            aria-labelledby={`${reviewTextId} ${titleId}`}
            className={`absolute right-4 bottom-2 py-1 px-1 text-xs text-gray-600 underline hover:text-teal-700 cursor-default ${
              reviewActive ? ACTIVE_OUTLINE_CLASS : ''
            }`}
          >
            <span id={reviewTextId}>Write a review</span>
          </div>
        </div>
      );
    }

    if (item.kind === 'landlord') {
      const result = item.result;
      const score = result.avgScore;
      const namedPartyScoreState = getNamedPartyScoreState(result.reviewCount, score);

      return (
        <div
          key={item.key}
          {...combobox.getOptionProps(openIndex)}
          className={`w-full text-left px-4 py-3 border-b border-gray-100 cursor-default transition-colors ${
            openActive ? `bg-teal-50 ${ACTIVE_OUTLINE_CLASS}` : 'hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-gray-900 truncate">{result.title}</div>
              <div className="text-sm text-gray-500 truncate">{result.subtitle}</div>
            </div>
            <div className="flex-shrink-0 flex items-center gap-2">
              {score !== null && namedPartyScoreState === 'available' && (
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${getScoreBgTint(score)} ${getScoreTextColor(score)}`}>
                  {score.toFixed(1)}
                </span>
              )}
              {namedPartyScoreState === 'below-threshold' && (
                <span className="text-xs text-gray-500">
                  Score after {NAMED_PARTY_MIN_REVIEWS}
                </span>
              )}
              {namedPartyScoreState === 'unavailable' && (
                <span className="text-xs text-gray-500">Score unavailable</span>
              )}
              {result.reviewCount > 0 && (
                <span className="text-xs text-gray-500">
                  {result.reviewCount} review{result.reviewCount !== 1 ? 's' : ''}
                </span>
              )}
              <span className="text-xs text-purple-600 font-medium">Landlord</span>
            </div>
          </div>
        </div>
      );
    }

    if (item.kind !== 'address') return null;

    // A Google address with no page on RateMyPlace that we could match. Visually
    // distinct from the rows above: it starts a review rather than opening a page.
    const prediction = item.prediction;
    return (
      <div
        key={item.key}
        {...combobox.getOptionProps(openIndex)}
        className={`w-full text-left px-4 py-3 cursor-default transition-colors flex items-center gap-3 ${
          openActive ? `bg-teal-50 ${ACTIVE_OUTLINE_CLASS}` : 'hover:bg-gray-50'
        }`}
      >
        <span
          aria-hidden="true"
          className="flex-shrink-0 w-7 h-7 rounded-full bg-teal-700 text-white flex items-center justify-center text-lg font-semibold leading-none"
        >
          +
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900 truncate">{prediction.mainText}</div>
          <div className="text-sm text-gray-500 truncate">{prediction.secondaryText}</div>
        </div>
        <span className="flex-shrink-0 text-xs text-teal-700 font-medium">
          Start a review <span aria-hidden="true">→</span>
        </span>
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onFocus={() => items.length > 0 && setShowDropdown(true)}
            {...combobox.inputProps}
            placeholder="Address, neighborhood, or landlord"
            aria-label={SEARCH_LABEL}
            className="w-full px-4 sm:px-6 py-4 rounded-[4px] bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-teal-300"
            autoComplete="off"
          />
          {isLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg aria-hidden="true" className="animate-spin h-5 w-5 text-teal-700" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          )}

          {popupOpen && (
            // The popup's own mouse presses keep focus in the input. Only the listbox scrolls:
            // a scrolling wrapper with no focusable content would be its own Tab stop.
            <div
              ref={dropdownRef}
              onMouseDown={keepInputFocus}
              className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 flex flex-col overflow-hidden"
            >
              <div {...combobox.listboxProps} className="min-h-0 overflow-y-auto">
                {ownRows.length > 0 && (
                  <div role="group" aria-labelledby={ownHeaderId}>
                    <div
                      id={ownHeaderId}
                      role="presentation"
                      className="px-4 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border-b border-teal-100"
                    >
                      On RateMyPlace
                    </div>
                    {ownRows.map((row) => renderRow(row, rows.indexOf(row)))}
                  </div>
                )}
                {addressRows.length > 0 && (
                  <div role="group" aria-labelledby={otherHeaderId}>
                    <div
                      id={otherHeaderId}
                      role="presentation"
                      className="px-4 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border-y border-gray-100"
                    >
                      Other addresses
                    </div>
                    {addressRows.map((row) => renderRow(row, rows.indexOf(row)))}
                  </div>
                )}
              </div>
              {googleResults.length > 0 && (
                <div className="shrink-0 px-4 py-2 text-xs text-gray-600 bg-gray-50 flex items-center gap-1">
                  <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  </svg>
                  Address suggestions powered by Google
                </div>
              )}
            </div>
          )}

          {/* Result counts, read once results settle (P4). */}
          <div role="status" aria-live="polite" className="sr-only">
            {combobox.statusText}
          </div>
        </div>

        <button
          type="submit"
          className="px-8 py-4 bg-teal-700 text-white font-semibold rounded-[4px] hover:bg-teal-800 transition-colors"
        >
          Search
        </button>
      </div>
    </form>
  );
}
