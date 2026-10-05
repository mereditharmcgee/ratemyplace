import { useEffect, useRef, useState, useCallback } from 'react';
import { MarkerClusterer, SuperClusterAlgorithm, type Marker, type Renderer } from '@googlemaps/markerclusterer';
import { getScoreColor, getScoreHex } from '../lib/scoring-colors';
import { displayLocality } from '../lib/locality';
import { initialMapView, shouldPanToUser, type LatLngBox, type LatLngPoint } from '../lib/mapView';
import { clusterAppearance, clusterBadgeSize, clusterTitle } from '../lib/mapCluster';

interface Building {
  id: string;
  address: string;
  slug: string;
  neighborhood: string | null;
  city: string | null;
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

// Where the map starts before the first fit. A module constant rather than a default-param
// literal, so it is one object across renders and does not re-run the marker effect.
const BOSTON_CENTER: LatLngPoint = { lat: 42.3601, lng: -71.0589 };

// Zoom when the map moves to the reader's own location.
const USER_LOCATION_ZOOM = 14;

// The global the Maps script calls once its libraries are usable. With `loading=async`,
// `script.onload` fires before that, so it is not the ready signal; this callback is.
const MAPS_READY_CALLBACK = '__rmpMapsReady';

// How long the map must sit still before a viewport refetch.
const IDLE_REFETCH_DEBOUNCE_MS = 300;

/** True once the Maps API and the marker library can actually be constructed. */
function mapsApiReady(): boolean {
  return Boolean(window.google?.maps?.Map && window.google.maps.marker?.AdvancedMarkerElement);
}

// One Maps script load per page, shared by every mount. Per-mount loading appended a second
// script on a remount and could tear down the callback a still-loading script was about to
// call; a module-level promise loads once and every caller waits on the same result.
let mapsLoad: Promise<void> | null = null;

/**
 * Load the Google Maps script with `loading=async`, once. Resolves when the API calls
 * MAPS_READY_CALLBACK; rejects on a script error and forgets the attempt, so a later mount
 * can try again. The script element is never removed: a script already fetching still runs.
 */
function loadMapsApi(apiKey: string): Promise<void> {
  if (mapsApiReady()) return Promise.resolve();
  if (mapsLoad) return mapsLoad;

  mapsLoad = new Promise<void>((resolve, reject) => {
    // Assigned before the script is appended, so it exists whenever the API looks for it.
    window[MAPS_READY_CALLBACK] = () => resolve();

    const params = new URLSearchParams({
      key: apiKey,
      libraries: 'marker',
      v: 'weekly',
      loading: 'async',
      callback: MAPS_READY_CALLBACK,
    });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      mapsLoad = null;
      reject(new Error('Failed to load Google Maps'));
    };
    document.head.appendChild(script);
  });
  return mapsLoad;
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

// Nearby markers group into clusters until street zoom: SuperCluster's pixel radius, and the
// last zoom at which it still clusters (individual pins from zoom 17 in).
const CLUSTER_RADIUS_PX = 60;
const CLUSTER_MAX_ZOOM = 16;

// Draws a cluster as a round badge with its count, filled with the band colour of the
// average score of the buildings inside (see src/lib/mapCluster.ts). DOM nodes and
// textContent only, no HTML strings: the hex is a SCORE_HEX constant and the count a number.
// Clicking it zooms in on the cluster (MarkerClusterer's default onClusterClick).
function clusterRenderer(scoreOf: WeakMap<Marker, number | null>): Renderer {
  return {
    render({ count, position, markers }) {
      const look = clusterAppearance(markers.map((m) => scoreOf.get(m) ?? null));
      const size = clusterBadgeSize(count);

      const badge = document.createElement('div');
      badge.style.cssText = [
        `width: ${size}px`,
        `height: ${size}px`,
        'border-radius: 9999px',
        `background: ${look.hex}`,
        'color: #fff',
        'border: 2px solid #fff',
        'box-shadow: 0 1px 3px rgba(15, 23, 42, 0.35)',
        'display: flex',
        'align-items: center',
        'justify-content: center',
        `font-size: ${size >= 48 ? 14 : 13}px`,
        'font-weight: 600',
        'font-variant-numeric: tabular-nums',
        'cursor: pointer',
        // AdvancedMarkerElement anchors content at its bottom centre, which suits a pin but
        // would float a round badge half its height above the cluster. Centre it instead.
        'transform: translateY(50%)',
      ].join('; ');
      badge.textContent = String(count);

      return new google.maps.marker.AdvancedMarkerElement({
        position,
        content: badge,
        title: clusterTitle(count, look.label),
        // Above the individual pins, larger clusters on top.
        zIndex: 1000 + count,
      });
    },
  };
}

export default function BuildingMap({
  apiKey,
  initialCenter = BOSTON_CENTER,
  initialZoom = 13
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  // One clusterer per map. It owns which markers are on the map: a marker is added to it,
  // never given `map` directly. The WeakMap lets its renderer colour a cluster by score.
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markerScoresRef = useRef(new WeakMap<Marker, number | null>());
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  // The first view is fitted once, on the first load with markers; the viewport refetches
  // that follow must never re-fit, or every pan would snap back.
  const didFitRef = useRef(false);
  const fittedBoxRef = useRef<LatLngBox | null>(null);
  const userLocationRef = useRef<LatLngPoint | null>(null);
  // Viewport refetches wait for the first (unbounded) load, so the one-time fit sees every
  // building rather than only those inside the default view the map opened on.
  const initialLoadDoneRef = useRef(false);
  // Latest request wins: a slow response for a viewport the reader has already left must not
  // overwrite the pins of the one they are looking at.
  const requestSeqRef = useRef(0);

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Script ready → map constructed → map interactive (first idle or tilesloaded).
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapCreated, setMapCreated] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
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
          userLocationRef.current = newLocation;
          // Move to the reader only when they are inside the area the markers were fitted
          // to. If the fit has not happened yet, the fit's own idle handler checks instead.
          if (mapInstanceRef.current && shouldPanToUser(newLocation, fittedBoxRef.current)) {
            mapInstanceRef.current.panTo(newLocation);
            mapInstanceRef.current.setZoom(USER_LOCATION_ZOOM);
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

  // Wait for the shared Maps script load (see loadMapsApi).
  useEffect(() => {
    let active = true;
    loadMapsApi(apiKey).then(
      () => {
        if (active) setMapLoaded(true);
      },
      () => {
        if (active) setError('Failed to load Google Maps');
      },
    );
    return () => {
      active = false;
    };
  }, [apiKey]);

  // Fetch buildings, optionally constrained to the current map viewport.
  const loadBuildings = useCallback(async (bounds?: google.maps.LatLngBounds | null) => {
    const seq = ++requestSeqRef.current;
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
      const data: { buildings?: Building[] } = await response.json();
      if (seq !== requestSeqRef.current) return; // superseded by a newer request
      setBuildings(data.buildings || []);
    } catch (err) {
      console.error('Failed to fetch buildings:', err);
      setError('Failed to load building data');
    } finally {
      // Not gated on `seq`: viewport refetches start only after the unbounded load has
      // finished, so this never flips `loading` early, and the refetch gate must always open.
      if (!bounds) initialLoadDoneRef.current = true;
      setLoading(false);
    }
  }, []);

  // Initial (unbounded) load, in parallel with the script and the map construction; the
  // idle listener then refetches by viewport bounds as the user pans/zooms.
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

  // Construct the map as soon as the script is ready and the container exists. This does
  // not wait for the buildings fetch: markers are added by the effect below when data lands.
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || mapInstanceRef.current) return;

    // Starts at the default view; the first non-empty marker build fits it to the markers.
    // No `styles` option: with a `mapId` set, Google ignores it, which is why the old
    // POI-hiding styles never took effect. Hiding POI labels needs a cloud map style attached
    // to this map ID — an owner action in the Google Cloud console, not code.
    const map = new google.maps.Map(mapRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      mapId: 'ratemyplace-map', // Required for AdvancedMarkerElement
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });
    mapInstanceRef.current = map;
    infoWindowRef.current = new google.maps.InfoWindow();
    clustererRef.current = new MarkerClusterer({
      map,
      algorithm: new SuperClusterAlgorithm({ radius: CLUSTER_RADIUS_PX, maxZoom: CLUSTER_MAX_ZOOM }),
      renderer: clusterRenderer(markerScoresRef.current),
    });

    // The overlay comes down once the map is interactive: the first idle after construction,
    // or the first full tile load, whichever fires first. Not on the buildings fetch.
    const markReady = () => setMapReady(true);
    google.maps.event.addListenerOnce(map, 'idle', markReady);
    google.maps.event.addListenerOnce(map, 'tilesloaded', markReady);

    // Refetch buildings for the current viewport whenever the map settles (debounced), so
    // only in-view buildings are loaded as the user pans/zooms. This listener never fits or
    // moves the map, so a refetch → marker rebuild cannot raise another idle and loop.
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    map.addListener('idle', () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!initialLoadDoneRef.current) return;
        const b = map.getBounds();
        if (b) loadBuildings(b);
      }, IDLE_REFETCH_DEBOUNCE_MS);
    });

    setMapCreated(true);
  }, [mapLoaded, initialCenter, initialZoom, loadBuildings]);

  // Build markers whenever the buildings change, once the map exists. Runs on an empty list
  // too, so a pan into an empty viewport clears stale markers instead of leaving them behind.
  useEffect(() => {
    const map = mapInstanceRef.current;
    const clusterer = clustererRef.current;
    if (!mapCreated || !map || !clusterer) return;

    // Clear existing markers (and their clusters). No draw here: addMarkers below draws once.
    clusterer.clearMarkers(true);
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];

    // Add markers for buildings. No `map` on the marker: the clusterer puts it on the map,
    // alone or inside a cluster badge, depending on zoom.
    buildings.forEach(building => {
      const markerElement = createMarkerElement(building);

      const marker = new google.maps.marker.AdvancedMarkerElement({
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

        // Not `building.neighborhood` raw: the geocoder sometimes stored a street-name word
        // ("Commonwealth" for 1027 Commonwealth Ave), which reads as nonsense under the
        // address. `displayLocality` falls back to the city, or to '' when there is nothing
        // trustworthy to show — same rule as search results and the building page.
        const locality = displayLocality(building);
        if (locality) {
          const localityLabel = document.createElement('p');
          localityLabel.style.cssText = 'margin: 0 0 8px 0; font-size: 12px; color: #666;';
          localityLabel.textContent = locality;
          container.appendChild(localityLabel);
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

      markerScoresRef.current.set(marker, building.avgScore);
      markers.push(marker);
    });
    clusterer.addMarkers(markers);

    // First non-empty build: fit the view to the markers, once. The map may have existed
    // (and gone idle) well before this; the fit still happens here, on the first data.
    if (!didFitRef.current && buildings.length > 0) {
      const view = initialMapView(buildings.map((b) => ({ lat: b.latitude, lng: b.longitude })));
      if (view) {
        didFitRef.current = true;
        fittedBoxRef.current = view.box;
        if (view.kind === 'center') {
          map.setCenter(view.center);
          map.setZoom(view.zoom);
        } else {
          map.fitBounds(view.box, view.padding);
        }
        google.maps.event.addListenerOnce(map, 'idle', () => {
          // fitBounds zooms as close as it can; a tight cluster should not open at roof level.
          const zoom = map.getZoom();
          if (view.kind === 'fit' && zoom !== undefined && zoom > view.maxZoom) {
            map.setZoom(view.maxZoom);
          }
          const user = userLocationRef.current;
          if (user && shouldPanToUser(user, view.box)) {
            map.panTo(user);
            map.setZoom(USER_LOCATION_ZOOM);
          }
        });
      }
    }
  }, [mapCreated, buildings, createMarkerElement]);

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

      {/* Loading overlay — z-20 to stay above Google Maps canvas. Down as soon as the map is
          interactive, which can be before the first buildings fetch lands; until it does, the
          "Loading buildings…" chip sits where the "in view" count goes. */}
      {!mapReady && (
        <div className="absolute inset-0 bg-gray-100 rounded-lg flex items-center justify-center z-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 mx-auto mb-2"></div>
            <p className="text-gray-600">Loading map...</p>
          </div>
        </div>
      )}

      {/* Legend — color + label pulled from the canonical scoring-colors source
          so the swatches always match the marker fills (all four bands). */}
      <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg p-3 text-sm">
        <div className="font-medium mb-2">Score Legend</div>
        <div className="space-y-1">
          {[
            { score: 4.5, range: '4–5' },
            { score: 3.5, range: '3–3.9' },
            { score: 2.5, range: '2–2.9' },
            { score: 1.5, range: '1–1.9' },
          ].map(({ score, range }) => (
            <div key={range} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ background: getScoreHex(score) }}></span>
              <span>{getScoreColor(score).label} ({range})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Building count, or a loading chip in the same place until the first fetch lands, so
          an interactive map with no pins yet is not mistaken for an empty one. */}
      {loading ? (
        <div role="status" className="absolute top-4 right-4 bg-white rounded-lg shadow-lg px-3 py-2 text-sm text-gray-600">
          Loading buildings…
        </div>
      ) : (
        <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg px-3 py-2 text-sm">
          <span className="font-medium">{buildings.length}</span> in view
        </div>
      )}
    </div>
  );
}
