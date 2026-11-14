import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { getScoreHex, getScoreTextHex } from '../scoring-colors';
import { composite, contrast } from './helpers/contrast';

// The map info window cannot be seen without a Maps key, so neither tests nor preview deploys
// open a real one. This mounts BuildingMap against a stubbed `google.maps`, clicks each marker
// and reads the band label the info window was handed. The label is small text on a light tint
// of the marker colour, so it needs 4.5:1. In the marker colour itself it was 1.95:1 for Mixed
// and 3.24:1 for Good.

vi.mock('@googlemaps/markerclusterer', () => ({
  MarkerClusterer: class {
    clearMarkers() {}
    addMarkers() {}
  },
  SuperClusterAlgorithm: class {},
}));

type Handler = () => void;

class StubAdvancedMarkerElement {
  static created: StubAdvancedMarkerElement[] = [];
  handlers = new Map<string, Handler>();
  constructor() {
    StubAdvancedMarkerElement.created.push(this);
  }
  addListener(name: string, handler: Handler) {
    this.handlers.set(name, handler);
  }
}

class StubInfoWindow {
  static content: HTMLElement | null = null;
  setContent(content: HTMLElement) {
    StubInfoWindow.content = content;
  }
  open() {}
}

class StubMap {
  addListener() {}
  getBounds() {
    return null;
  }
  getZoom() {
    return 13;
  }
  setZoom() {}
  setCenter() {}
  fitBounds() {}
  panTo() {}
}

const stubGoogle = {
  maps: {
    Map: StubMap,
    InfoWindow: StubInfoWindow,
    marker: { AdvancedMarkerElement: StubAdvancedMarkerElement },
    event: {
      addListenerOnce: (_target: unknown, _name: string, handler: () => void) => handler(),
      trigger() {},
    },
  },
};

// Five reviews each, so none is an early rating (that path draws the label in gray-600).
const BUILDINGS = [4.5, 3.5, 2.5, 1.5, null].map((avgScore, i) => ({
  id: `b${i}`,
  address: `${i + 1} Example Rd`,
  slug: `${i + 1}-example-rd`,
  neighborhood: null,
  city: 'Boston',
  latitude: 42.35 + i * 0.001,
  longitude: -71.06,
  reviewCount: avgScore === null ? 0 : 5,
  avgScore,
}));

beforeEach(() => {
  StubAdvancedMarkerElement.created = [];
  StubInfoWindow.content = null;
  vi.stubGlobal('google', stubGoogle);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ buildings: BUILDINGS }), { status: 200 })),
  );
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (_ok: unknown, denied: () => void) => denied() },
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as { geolocation?: unknown }).geolocation;
});

/** "#92400e", "#f59e0b20", "rgb(146, 64, 14)" or "rgba(245, 158, 11, 0.125)" over white. */
function paintedOnWhite(color: string): string {
  const hex = color.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) return composite(`#${hex[1]}`, hex[2] ? parseInt(hex[2], 16) / 255 : 1, '#ffffff');
  const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  if (!rgb) throw new Error(`unreadable colour: ${color}`);
  const base = `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  return composite(base, rgb[4] === undefined ? 1 : Number(rgb[4]), '#ffffff');
}

describe('map info window band label', () => {
  it('draws each band label in its text colour, 4.5:1 or better on its tint', async () => {
    const { default: BuildingMap } = await import('../../components/BuildingMap');
    render(<BuildingMap apiKey="test-key" />);
    await waitFor(() => expect(StubAdvancedMarkerElement.created).toHaveLength(BUILDINGS.length));

    StubAdvancedMarkerElement.created.forEach((marker, i) => {
      const building = BUILDINGS[i];
      marker.handlers.get('click')!();
      const content = StubInfoWindow.content!;
      const badge = content.querySelector('div > span') as HTMLElement;
      expect(badge.textContent).not.toBe('');

      const text = paintedOnWhite(badge.style.color);
      const tint = paintedOnWhite(badge.style.background || badge.style.backgroundColor);
      expect(text).toBe(getScoreTextHex(building.avgScore).toLowerCase());
      expect(text).not.toBe(getScoreHex(building.avgScore).toLowerCase());
      expect(contrast(text, tint), `${badge.textContent}: ${text} on ${tint}`).toBeGreaterThanOrEqual(4.5);
    });
  });
});
