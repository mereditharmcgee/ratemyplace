import { useState, useEffect, useRef, useCallback } from 'react';

interface DbResult {
  id: string;
  type: 'building' | 'landlord';
  title: string;
  subtitle: string;
  slug: string;
  reviewCount: number;
  avgScore: number | null;
}

interface GooglePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

type DropdownItem =
  | { source: 'local'; data: DbResult }
  | { source: 'google'; data: GooglePrediction };

function generateSessionToken(): string {
  return crypto.randomUUID();
}

export default function HomeSearch() {
  const [inputValue, setInputValue] = useState('');
  const [dbResults, setDbResults] = useState<DbResult[]>([]);
  const [googleResults, setGoogleResults] = useState<GooglePrediction[]>([]);
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [sessionToken] = useState(() => generateSessionToken());

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dbDebounceRef = useRef<NodeJS.Timeout>();

  // Google rows surface addresses we don't have yet. Clicking one navigates
  // straight into /review/new?placeId=..., which resolves the address
  // server-side and opens the review form at the unit-details step.
  // Filter out Google rows that exactly match an existing DB building so
  // we don't show the same address twice.
  const items: DropdownItem[] = [
    ...dbResults.map((r): DropdownItem => ({ source: 'local', data: r })),
    ...googleResults
      .filter(g => !dbResults.some(d =>
        d.type === 'building' && d.title.toLowerCase() === g.mainText.toLowerCase()
      ))
      .map((g): DropdownItem => ({ source: 'google', data: g })),
  ];

  const fetchGoogleResults = useCallback(async (input: string) => {
    if (input.length < 3) {
      setGoogleResults([]);
      return;
    }
    setIsLoadingGoogle(true);
    try {
      const params = new URLSearchParams({ input, sessionToken });
      const response = await fetch(`/api/places/autocomplete?${params}`);
      const data = await response.json();
      setGoogleResults(data.predictions || []);
      setShowDropdown(true);
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
      const results = data.results || [];
      setDbResults(results);
      setShowDropdown(true);
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setHighlightedIndex(-1);

    if (dbDebounceRef.current) clearTimeout(dbDebounceRef.current);

    if (!value.trim()) {
      setDbResults([]);
      setGoogleResults([]);
      setShowDropdown(false);
      return;
    }

    dbDebounceRef.current = setTimeout(() => fetchDbResults(value), 150);
  };

  const handleSelectItem = (item: DropdownItem) => {
    setShowDropdown(false);
    setDbResults([]);
    setGoogleResults([]);

    if (item.source === 'local') {
      const { type, slug } = item.data;
      window.location.href = `/${type === 'building' ? 'building' : 'landlord'}/${slug}`;
    } else {
      // Google "new address" row: hand off to /review/new with the placeId.
      // The page resolves the place server-side and opens the form at the
      // unit-details step.
      window.location.href = `/review/new?placeId=${encodeURIComponent(item.data.placeId)}`;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (highlightedIndex >= 0 && highlightedIndex < items.length) {
      handleSelectItem(items[highlightedIndex]);
    } else if (inputValue.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(inputValue.trim())}`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || items.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => prev < items.length - 1 ? prev + 1 : 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => prev > 0 ? prev - 1 : items.length - 1);
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
    return () => { if (dbDebounceRef.current) clearTimeout(dbDebounceRef.current); };
  }, []);

  const isLoading = isLoadingDb || isLoadingGoogle;
  const googleItems = items.filter((i): i is { source: 'google'; data: GooglePrediction } => i.source === 'google');

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
            onFocus={() => items.length > 0 && setShowDropdown(true)}
            placeholder="Search by address, neighborhood, or landlord..."
            className="w-full px-6 py-4 rounded-lg bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-teal-300"
            autoComplete="off"
          />
          {isLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg className="animate-spin h-5 w-5 text-teal-700" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          )}

          {showDropdown && items.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
            >
              {dbResults.length > 0 && (
                <div className="px-4 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border-b border-teal-100">
                  In our system
                </div>
              )}
              {items.map((item, index) => {
                const highlighted = highlightedIndex === index;
                if (item.source === 'local') {
                  return (
                    <button
                      key={`db-${item.data.id}`}
                      type="button"
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                        highlighted ? 'bg-teal-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-gray-900 truncate">{item.data.title}</div>
                          <div className="text-sm text-gray-500 truncate">{item.data.subtitle}</div>
                        </div>
                        <div className="flex-shrink-0 flex items-center gap-2">
                          {item.data.avgScore !== null && (
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                              item.data.avgScore >= 4 ? 'bg-emerald-100 text-emerald-700' :
                              item.data.avgScore >= 3 ? 'bg-amber-100 text-amber-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {item.data.avgScore.toFixed(1)}
                            </span>
                          )}
                          {item.data.reviewCount > 0 && (
                            <span className="text-xs text-gray-400">
                              {item.data.reviewCount} review{item.data.reviewCount !== 1 ? 's' : ''}
                            </span>
                          )}
                          {item.data.type === 'landlord' && (
                            <span className="text-xs text-purple-500 font-medium">Landlord</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                }

                // Google "add new" row — visually distinct from DB matches so
                // it's clear this is an action that creates a new entry, not
                // a destination that lands on an existing property page.
                const firstGoogleIndex = dbResults.length;
                const isFirstGoogle = index === firstGoogleIndex;
                return (
                  <div key={`g-${item.data.placeId}`}>
                    {isFirstGoogle && (
                      <div className="px-4 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border-y border-gray-100">
                        Add a review for an address we don't have yet
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 transition-colors flex items-center gap-3 ${
                        highlighted ? 'bg-teal-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-teal-700 text-white flex items-center justify-center text-lg font-semibold leading-none">
                        +
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900 truncate">{item.data.mainText}</div>
                        <div className="text-sm text-gray-500 truncate">{item.data.secondaryText}</div>
                      </div>
                      <span className="flex-shrink-0 text-xs text-teal-700 font-medium">
                        Start a review →
                      </span>
                    </button>
                  </div>
                );
              })}
              {googleItems.length > 0 && (
                <div className="px-4 py-2 text-xs text-gray-400 bg-gray-50 flex items-center gap-1">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  </svg>
                  Address suggestions powered by Google
                </div>
              )}
            </div>
          )}
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
