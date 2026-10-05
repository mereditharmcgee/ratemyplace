interface Props {
  searchInput: string;
  onSearchInput: (value: string) => void;
  /** Set when the list is narrowed to one landlord (`?landlord=`). */
  landlordId: string | null;
  /** The landlord's name from the API, or null when the id matched no landlord. */
  landlordName: string | null;
  onClearLandlord: () => void;
  orphansOnly: boolean;
  onOrphansOnly: (value: boolean) => void;
  refreshing: boolean;
}

/** Search box, landlord chip, and orphan toggle for the admin buildings list. Filtering runs on the server. */
export default function BuildingsFilterBar({
  searchInput,
  onSearchInput,
  landlordId,
  landlordName,
  onClearLandlord,
  orphansOnly,
  onOrphansOnly,
  refreshing,
}: Props) {
  return (
    <div className="space-y-2">
      <input
        type="search"
        aria-label="Search buildings"
        placeholder="Search all buildings by address, city, or ZIP..."
        value={searchInput}
        maxLength={200}
        onChange={(e) => onSearchInput(e.target.value)}
        className="w-full px-4 py-2 border border-gray-300 rounded-[4px] focus:ring-2 focus:ring-teal-500 focus:border-transparent"
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {landlordId && (
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-800">
            <span>
              Filtered to {landlordName ?? `an unknown landlord (${landlordId})`}
            </span>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={onClearLandlord} className="font-medium underline hover:text-teal-900">
              clear
            </button>
          </span>
        )}
        <label className="inline-flex items-center gap-2 text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={orphansOnly}
            onChange={(e) => onOrphansOnly(e.target.checked)}
            className="rounded border-gray-300 text-teal-700 focus:ring-teal-500"
          />
          Outside Boston / New Haven, no reviews
        </label>
        {refreshing && <span className="text-gray-500">Updating...</span>}
      </div>
    </div>
  );
}
