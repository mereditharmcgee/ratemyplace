import { useEffect, useRef, useState, useCallback } from 'react';
import { getScoreColor, getScoreHex } from '../lib/scoring-colors';

interface Building {
  id: string;
  address: string;
  slug: string;
  neighborhood: string | null;
  latitude: number;
  longitude: number;
  reviewCount: number;
  avgScore: number | null;
}

interface Props {
  apiKey: string;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
}

// Marker hex + label come from the canonical brand system in src/lib/scoring-colors.ts.
// Local getMarkerHex / getMarkerLabel exist only because Google Maps takes hex strings, not Tailwind classes.
function getMarkerHex(score: number | null): string {
  return getScoreHex(score);
}

function getMarkerLabel(score: number | null): string {
  if (score === null) return 'No reviews';
  return getScoreColor(score).label;
}

export default function BuildingMap({
  apiKey,
  initialCenter = { lat: 42.3601, lng: -71.0589 }, // Default to Boston
  initialZoom = 13
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationRequested, setLocationRequested] = useState(false);

  // Try to get user's location
  useEffect(() => {
    if (locationRequested) return;
    setLocationRequested(true);

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setUserLocation(newLocation);
          // If map is already initialized, pan to user location
          if (mapInstanceRef.current) {
            mapInstanceRef.current.panTo(newLocation);
            mapInstanceRef.current.setZoom(14);
          }
        },
        (err) => {
          console.log('Geolocation not available or denied, using default location');
          // User denied or error - we'll use the default (Boston)
        },
        { timeout: 5000, enableHighAccuracy: false }
      );
    }
  }, [locationRequested]);

  // Load Google Maps script
  useEffect(() => {
    if (window.google?.maps) {
      setMapLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => setMapLoaded(true);
    script.onerror = () => setError('Failed to load Google Maps');
    document.head.appendChild(script);

    return () => {
      // Cleanup script if component unmounts before load
      if (!window.google?.maps) {
        document.head.removeChild(script);
      }
    };
  }, [apiKey]);

  // Fetch buildings, optionally constrained to the current map viewport.
  const loadBuildings = useCallback(async (bounds?: google.maps.LatLngBounds | null) => {
    try {
      let url = '/api/buildings/map';
      if (bounds) {
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        const params = new URLSearchParams({
          north: String(ne.lat()),
          south: String(sw.lat()),
          east: String(ne.lng()),
          west: String(sw.lng()),
        });
        url += `?${params.toString()}`;
      }
      const response = await fetch(url);
      const data = await response.json();
      setBuildings(data.buildings || []);
    } catch (err) {
      console.error('Failed to fetch buildings:', err);
      setError('Failed to load building data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial (unbounded) load so the map can initialize; the idle listener below
  // then refetches by viewport bounds as the user pans/zooms.
  useEffect(() => {
    loadBuildings();
  }, [loadBuildings]);

  // Create custom marker element
  const createMarkerElement = useCallback((building: Building): HTMLElement => {
    const color = getMarkerHex(building.avgScore);

    const container = document.createElement('div');
    container.className = 'building-marker';
    container.style.cssText = `
      cursor: pointer;
      transition: transform 0.2s ease;
    `;

    // Create pin SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '32');
    svg.setAttribute('height', '40');
    svg.setAttribute('viewBox', '0 0 32 40');
    svg.innerHTML = `
      <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 24 16 24s16-12 16-24c0-8.837-7.163-16-16-16z" fill="${color}"/>
      <circle cx="16" cy="14" r="8" fill="white" opacity="0.9"/>
      <text x="16" y="18" text-anchor="middle" font-size="10" font-weight="bold" fill="${color}">
        ${building.avgScore !== null ? building.avgScore.toFixed(1) : '?'}
      </text>
    `;

    container.appendChild(svg);

    // Hover effect
    container.addEventListener('mouseenter', () => {
      container.style.transform = 'scale(1.2)';
      container.style.zIndex = '1000';
    });
    container.addEventListener('mouseleave', () => {
      container.style.transform = 'scale(1)';
      container.style.zIndex = '';
    });

    return container;
  }, []);

  // Initialize map and markers
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;

    // Before the map exists we need at least one building to justify init;
    // with none, clear the loading overlay and wait. Once the map IS
    // initialized we fall through even when empty, so a pan into an empty
    // viewport clears stale markers instead of leaving them behind.
    if (buildings.length === 0 && !mapInstanceRef.current) {
      if (!loading) setTilesLoaded(true);
      return;
    }

    // Initialize map
    if (!mapInstanceRef.current) {
      // Use user location if available, otherwise use initialCenter
      const mapCenter = userLocation || initialCenter;
      mapInstanceRef.current = new google.maps.Map(mapRef.current, {
        center: mapCenter,
        zoom: userLocation ? 14 : initialZoom,
        mapId: 'ratemyplace-map', // Required for AdvancedMarkerElement
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        styles: [
          {
            featureType: 'poi',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
          }
        ]
      });

      infoWindowRef.current = new google.maps.InfoWindow();

      mapInstanceRef.current.addListener('tilesloaded', () => {
        setTilesLoaded(true);
      });

      // Refetch buildings for the current viewport whenever the map settles
      // (debounced), so only in-view buildings are loaded as the user pans/zooms.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      mapInstanceRef.current.addListener('idle', () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          const b = mapInstanceRef.current?.getBounds();
          if (b) loadBuildings(b);
        }, 300);
      });
    }

    // Clear existing markers
    markersRef.current.forEach(marker => marker.map = null);
    markersRef.current = [];

    // Add markers for buildings
    buildings.forEach(building => {
      const markerElement = createMarkerElement(building);

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: mapInstanceRef.current,
        position: { lat: building.latitude, lng: building.longitude },
        content: markerElement,
        title: building.address
      });

      marker.addListener('click', () => {
        setSelectedBuilding(building);

        const scoreLabel = getMarkerLabel(building.avgScore);
        const scoreColor = getMarkerHex(building.avgScore);

        // Build the InfoWindow with DOM nodes + textContent rather than an HTML
        // string. building.address / .neighborhood are user-supplied (created via
        // POST /api/buildings, unmoderated) and setContent() parses a string as
        // HTML — interpolating them raw was a stored-XSS sink. textContent never
        // parses markup. scoreColor is a SCORE_HEX constant (safe to inline).
        const container = document.createElement('div');
        container.style.cssText = 'padding: 8px; max-width: 250px;';

        const heading = document.createElement('h3');
        heading.style.cssText = 'margin: 0 0 4px 0; font-size: 14px; font-weight: 600;';
        heading.textContent = building.address;
        container.appendChild(heading);

        if (building.neighborhood) {
          const neighborhood = document.createElement('p');
          neighborhood.style.cssText = 'margin: 0 0 8px 0; font-size: 12px; color: #666;';
          neighborhood.textContent = building.neighborhood;
          container.appendChild(neighborhood);
        }

        const scoreRow = document.createElement('div');
        scoreRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
        const scoreBadge = document.createElement('span');
        scoreBadge.style.cssText = `display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; background: ${scoreColor}20; color: ${scoreColor};`;
        scoreBadge.textContent = scoreLabel;
        scoreRow.appendChild(scoreBadge);
        if (building.avgScore !== null) {
          const scoreNumber = document.createElement('span');
          scoreNumber.style.cssText = 'font-size: 14px; font-weight: 600;';
          scoreNumber.textContent = `${building.avgScore.toFixed(1)}/5`;
          scoreRow.appendChild(scoreNumber);
        }
        container.appendChild(scoreRow);

        const reviewCountLine = document.createElement('p');
        reviewCountLine.style.cssText = 'margin: 0 0 8px 0; font-size: 12px; color: #666;';
        reviewCountLine.textContent = `${building.reviewCount} ${building.reviewCount === 1 ? 'review' : 'reviews'}`;
        container.appendChild(reviewCountLine);

        const detailsLink = document.createElement('a');
        detailsLink.href = `/building/${encodeURIComponent(building.slug)}`;
        detailsLink.style.cssText = 'display: inline-block; padding: 6px 12px; background: #1A9A7D; color: white; text-decoration: none; border-radius: 6px; font-size: 12px; font-weight: 500;';
        detailsLink.textContent = 'View Details';
        container.appendChild(detailsLink);

        infoWindowRef.current?.setContent(container);
        infoWindowRef.current?.open(mapInstanceRef.current, marker);
      });

      markersRef.current.push(marker);
    });

  }, [mapLoaded, buildings, initialCenter, initialZoom, createMarkerElement, userLocation]);

  if (error) {
    return (
      <div className="w-full h-[500px] bg-gray-100 rounded-[6px] flex items-center justify-center">
        <div className="text-center text-gray-600">
          <p className="font-medium">Failed to load map</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Map container */}
      <div
        ref={mapRef}
        className="w-full h-[500px] md:h-[600px] rounded-[6px] overflow-hidden"
      />

      {/* Loading overlay — z-20 to stay above Google Maps canvas */}
      {(loading || !mapLoaded || !tilesLoaded) && (
        <div className="absolute inset-0 bg-gray-100 rounded-lg flex items-center justify-center z-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 mx-auto mb-2"></div>
            <p className="text-gray-600">Loading map...</p>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg p-3 text-sm">
        <div className="font-medium mb-2">Score Legend</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: '#2D9B83' }}></span>
            <span>Good (4-5)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: '#E8B44A' }}></span>
            <span>Mixed (3-4)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: '#D97356' }}></span>
            <span>Concerning (1-3)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: '#6B7280' }}></span>
            <span>No reviews</span>
          </div>
        </div>
      </div>

      {/* Building count */}
      {!loading && (
        <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg px-3 py-2 text-sm">
          <span className="font-medium">{buildings.length}</span> in view
        </div>
      )}
    </div>
  );
}
