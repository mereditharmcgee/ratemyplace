import { useState } from 'react';
import { getScoreTextColor } from '../../lib/scoring-colors';

interface Building {
  slug: string;
  address: string;
  neighborhood?: string;
  city: string;
  state: string;
  landlord_name?: string;
  review_count: number;
  avg_overall: number | null;
}

interface Landlord {
  slug: string;
  name: string;
  building_count: number;
  review_count: number;
  avg_overall: number | null;
}

interface Props {
  initialBuildings: Building[];
  initialLandlords: Landlord[];
  totalBuildings: number;
  totalLandlords: number;
  query: string;
  showIcons?: boolean;
}

const PAGE_SIZE = 10;

function BuildingCard({ building }: { building: Building }) {
  return (
    <a
      href={`/building/${building.slug}`}
      className="block bg-white border border-gray-200 rounded-[6px] p-6 hover:shadow-md transition-shadow"
    >
      <div className="flex justify-between items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-gray-900 break-words">{building.address}</h3>
          <p className="text-gray-600">
            {building.neighborhood && `${building.neighborhood}, `}{building.city}, {building.state}
          </p>
          {building.landlord_name && (
            <p className="text-sm text-gray-500 mt-1">Landlord: {building.landlord_name}</p>
          )}
        </div>
        <div className="text-right">
          {building.avg_overall ? (
            <div>
              <div className={`text-2xl font-bold ${getScoreTextColor(Number(building.avg_overall))}`}>{Number(building.avg_overall).toFixed(1)}</div>
              <div className="text-sm text-gray-500">{building.review_count} review{building.review_count !== 1 ? 's' : ''}</div>
            </div>
          ) : (
            <span className="text-sm text-gray-400">No reviews yet</span>
          )}
        </div>
      </div>
    </a>
  );
}

function LandlordCard({ landlord }: { landlord: Landlord }) {
  return (
    <a
      href={`/landlord/${landlord.slug}`}
      className="block bg-white border border-gray-200 rounded-[6px] p-6 hover:shadow-md transition-shadow"
    >
      <div className="flex justify-between items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-gray-900 break-words">{landlord.name}</h3>
          {landlord.building_count > 0 && (
            <p className="text-gray-600">{landlord.building_count} building{landlord.building_count !== 1 ? 's' : ''}</p>
          )}
        </div>
        <div className="text-right">
          {landlord.avg_overall ? (
            <div>
              <div className={`text-2xl font-bold ${getScoreTextColor(Number(landlord.avg_overall))}`}>{Number(landlord.avg_overall).toFixed(1)}</div>
              <div className="text-sm text-gray-500">{landlord.review_count} review{landlord.review_count !== 1 ? 's' : ''}</div>
            </div>
          ) : (
            <span className="text-sm text-gray-400">No reviews yet</span>
          )}
        </div>
      </div>
    </a>
  );
}

function LoadMoreButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <div className="mt-6 text-center">
      <button
        onClick={onClick}
        disabled={loading}
        className="px-6 py-2.5 bg-white border border-gray-300 text-gray-700 font-medium rounded-[6px] hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <span className="flex items-center gap-2 justify-center">
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Loading...
          </span>
        ) : 'Load more'}
      </button>
    </div>
  );
}

export default function SearchResults({
  initialBuildings,
  initialLandlords,
  totalBuildings,
  totalLandlords,
  query,
  showIcons = false,
}: Props) {
  const [buildings, setBuildings] = useState<Building[]>(initialBuildings);
  const [landlords, setLandlords] = useState<Landlord[]>(initialLandlords);
  const [loadingBuildings, setLoadingBuildings] = useState(false);
  const [loadingLandlords, setLoadingLandlords] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMoreBuildings = buildings.length < totalBuildings;
  const hasMoreLandlords = landlords.length < totalLandlords;

  const loadMoreBuildings = async () => {
    setLoadingBuildings(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        type: 'buildings',
        offset: String(buildings.length),
        limit: String(PAGE_SIZE),
      });
      if (query) params.set('q', query);

      const response = await fetch(`/api/search/results?${params}`);
      const data = await response.json();
      setBuildings(prev => [...prev, ...(data.results || [])]);
    } catch {
      setError('Failed to load more results. Please try again.');
    } finally {
      setLoadingBuildings(false);
    }
  };

  const loadMoreLandlords = async () => {
    setLoadingLandlords(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        type: 'landlords',
        offset: String(landlords.length),
        limit: String(PAGE_SIZE),
      });
      if (query) params.set('q', query);

      const response = await fetch(`/api/search/results?${params}`);
      const data = await response.json();
      setLandlords(prev => [...prev, ...(data.results || [])]);
    } catch {
      setError('Failed to load more results. Please try again.');
    } finally {
      setLoadingLandlords(false);
    }
  };

  const buildingIcon = (
    <svg className="w-5 h-5 text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );

  const landlordIcon = (
    <svg className="w-5 h-5 text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-[6px] text-sm text-red-700">
          {error}
        </div>
      )}

      {buildings.length > 0 && (
        <div className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            {showIcons && buildingIcon}
            {query ? `Buildings (${totalBuildings})` : `Reviewed buildings (${totalBuildings})`}
          </h2>
          <div className="grid gap-4">
            {buildings.map((building) => (
              <BuildingCard key={building.slug} building={building} />
            ))}
          </div>
          {hasMoreBuildings && (
            <LoadMoreButton onClick={loadMoreBuildings} loading={loadingBuildings} />
          )}
        </div>
      )}

      {landlords.length > 0 && (
        <div className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            {showIcons && landlordIcon}
            Landlords ({totalLandlords})
          </h2>
          <div className="grid gap-4">
            {landlords.map((landlord) => (
              <LandlordCard key={landlord.slug} landlord={landlord} />
            ))}
          </div>
          {hasMoreLandlords && (
            <LoadMoreButton onClick={loadMoreLandlords} loading={loadingLandlords} />
          )}
        </div>
      )}
    </div>
  );
}
