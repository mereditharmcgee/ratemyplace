import { useEffect, useRef, useState, useCallback } from 'react';

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

// Score color mapping based on brand guidelines
function getScoreColor(score: number | null): string {
  if (score === null) return '#6B7280'; // Gray for no reviews
  if (score >= 4) return '#2D9B83';     // Good (teal-ish green)
  if (score >= 3) return '#E8B44A';     // Mixed (amber)
  return '#D97356';                      // Concerning (coral)
}

function getScoreLabel(score: number | null): string {
  if (score === null) return 'No reviews';
  if (score >= 4) return 'Good';
  if (score >= 3) return 'Mixed';
  return 'Concerning';
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

  // Fetch buildings data
  useEffect(() => {
    async function fetchBuildings() {
      try {
        const response = await fetch('/api/buildings/map');
        const data = await response.json();
        setBuildings(data.buildings || []);
      } catch (err) {
        console.error('Failed to fetch buildings:', err);
        setError('Failed to load building data');
      } finally {
        setLoading(false);
      }
    }

    fetchBuildings();
  }, []);

  // Create custom marker element
  const createMarkerElement = useCallback((building: Building): HTMLElement => {
    const color = getScoreColor(building.avgScore);

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
    if (!mapLoaded || !mapRef.current || buildings.length === 0) return;

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

        const scoreLabel = getScoreLabel(building.avgScore);
        const scoreColor = getScoreColor(building.avgScore);

        const content = `
          <div style="padding: 8px; max-width: 250px;">
            <h3 style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600;">${building.address}</h3>
            ${building.neighborhood ? `<p style="margin: 0 0 8px 0; font-size: 12px; color: #666;">${building.neighborhood}</p>` : ''}
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
              <span style="
                display: inline-block;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 500;
                background: ${scoreColor}20;
                color: ${scoreColor};
              ">${scoreLabel}</span>
              ${building.avgScore !== null ? `<span style="font-size: 14px; font-weight: 600;">${building.avgScore.toFixed(1)}/5</span>` : ''}
            </div>
            <p style="margin: 0 0 8px 0; font-size: 12px; color: #666;">
              ${building.reviewCount} ${building.reviewCount === 1 ? 'review' : 'reviews'}
            </p>
            <a href="/building/${building.slug}" style="
              display: inline-block;
              padding: 6px 12px;
              background: #1A9A7D;
              color: white;
              text-decoration: none;
              border-radius: 6px;
              font-size: 12px;
              font-weight: 500;
            ">View Details</a>
          </div>
        `;

        infoWindowRef.current?.setContent(content);
        infoWindowRef.current?.open(mapInstanceRef.current, marker);
      });

      markersRef.current.push(marker);
    });

  }, [mapLoaded, buildings, initialCenter, initialZoom, createMarkerElement, userLocation]);

  if (error) {
    return (
      <div className="w-full h-[500px] bg-gray-100 rounded-lg flex items-center justify-center">
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
        className="w-full h-[500px] md:h-[600px] rounded-lg overflow-hidden"
      />

      {/* Loading overlay */}
      {(loading || !mapLoaded) && (
        <div className="absolute inset-0 bg-gray-100 rounded-lg flex items-center justify-center">
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
          <span className="font-medium">{buildings.length}</span> buildings
        </div>
      )}
    </div>
  );
}
