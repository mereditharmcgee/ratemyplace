// Ambient types for the Google Maps JS API loaded at runtime via <script> in BuildingMap.tsx.
// Minimal surface covering only the members BuildingMap actually uses. This avoids adding
// @types/google.maps as a dependency (see chore/type-safety-cleanup constraints).
declare namespace google.maps {
  class Map {
    constructor(el: HTMLElement, opts?: any);
    addListener(event: string, handler: (...args: any[]) => void): void;
    getBounds(): LatLngBounds | undefined;
    getZoom(): number | undefined;
    fitBounds(bounds: LatLngBounds | LatLngBoundsLiteral, padding?: number): void;
    panTo(latLng: { lat: number; lng: number }): void;
    setZoom(zoom: number): void;
    setCenter(latLng: { lat: number; lng: number }): void;
  }

  interface LatLngBoundsLiteral {
    east: number;
    north: number;
    south: number;
    west: number;
  }

  interface MapsEventListener {
    remove(): void;
  }

  namespace event {
    function addListenerOnce(instance: object, eventName: string, handler: () => void): MapsEventListener;
  }

  class InfoWindow {
    constructor(opts?: any);
    setContent(content: string | Node): void;
    open(map?: any, anchor?: any): void;
  }

  class LatLngBounds {
    getNorthEast(): { lat(): number; lng(): number };
    getSouthWest(): { lat(): number; lng(): number };
  }

  namespace marker {
    class AdvancedMarkerElement {
      constructor(opts: any);
      map: any;
      content: any;
      addListener(event: string, handler: (...args: any[]) => void): void;
    }
  }
}

interface Window {
  google: typeof google;
}
