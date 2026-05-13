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

export default function HomeSearch() {
  const [inputValue, setInputValue] = useState('');
  const [dbResults, setDbResults] = useState<DbResult[]>([]);
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dbDebounceRef = useRef<NodeJS.Timeout>();

  // DB-only search. Homepage no longer calls Google Places —
  // free-text queries fall through to /search?q= on submit.
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
      setDbResults(data.results || []);
      setShowDropdown(true);
    } catch {
      setDbResults([]);
    } finally {
      setIsLoadingDb(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setHighlightedIndex(-1);

    if (dbDebounceRef.current) clearTimeout(dbDebounceRef.current);

    if (!value.trim()) {
      setDbResults([]);
      setShowDropdown(false);
      return;
    }

    dbDebounceRef.current = setTimeout(() => fetchDbResults(value), 150);
  };

  const handleSelectItem = (item: DbResult) => {
    setShowDropdown(false);
    setDbResults([]);
    const { type, slug } = item;
    window.location.href = `/${type === 'building' ? 'building' : 'landlord'}/${slug}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (highlightedIndex >= 0 && highlightedIndex < dbResults.length) {
      handleSelectItem(dbResults[highlightedIndex]);
    } else if (inputValue.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(inputValue.trim())}`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || dbResults.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => prev < dbResults.length - 1 ? prev + 1 : 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => prev > 0 ? prev - 1 : dbResults.length - 1);
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
            onFocus={() => dbResults.length > 0 && setShowDropdown(true)}
            placeholder="Search by address, neighborhood, or landlord..."
            className="w-full px-6 py-4 rounded-lg bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-4 focus:ring-teal-300"
            autoComplete="off"
          />
          {isLoadingDb && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg className="animate-spin h-5 w-5 text-teal-700" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          )}

          {showDropdown && dbResults.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
            >
              {dbResults.map((item, index) => (
                <button
                  key={`db-${item.id}`}
                  type="button"
                  onClick={() => handleSelectItem(item)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 transition-colors ${
                    highlightedIndex === index ? 'bg-teal-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 truncate">{item.title}</div>
                      <div className="text-sm text-gray-500 truncate">{item.subtitle}</div>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {item.avgScore !== null && (
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                          item.avgScore >= 4 ? 'bg-emerald-100 text-emerald-700' :
                          item.avgScore >= 3 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {item.avgScore.toFixed(1)}
                        </span>
                      )}
                      {item.reviewCount > 0 && (
                        <span className="text-xs text-gray-400">
                          {item.reviewCount} review{item.reviewCount !== 1 ? 's' : ''}
                        </span>
                      )}
                      {item.type === 'landlord' && (
                        <span className="text-xs text-purple-500 font-medium">Landlord</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
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
