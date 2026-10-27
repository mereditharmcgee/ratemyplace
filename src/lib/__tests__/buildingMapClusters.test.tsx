import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Renderer } from '@googlemaps/markerclusterer';
import { CLUSTER_COLORS, CLUSTER_LEGEND_LABEL, clusterBadgeSize } from '../mapCluster';
import { SCORE_HEX } from '../scoring-colors';

// The map cannot run without a Maps key, so neither tests nor preview deploys see a real
// Google map. This mounts BuildingMap against a stubbed `google.maps` and a stubbed
// clusterer: the legend renders as on /map, and the renderer the island hands the clusterer
// is called directly to draw a cluster badge.

const clustererOptions: { renderer?: Renderer }[] = [];

vi.mock('@googlemaps/markerclusterer', () => ({
  MarkerClusterer: class {
    constructor(options: { renderer?: Renderer }) {
      clustererOptions.push(options);
    }
    clearMarkers() {}
    addMarkers() {}
  },
  SuperClusterAlgorithm: class {},
}));

interface StubMarkerOptions {
  title?: string;
  content?: HTMLElement;
  zIndex?: number;
}

class StubAdvancedMarkerElement {
  options: StubMarkerOptions;
  constructor(options: StubMarkerOptions) {
    this.options = options;
  }
  addListener() {}
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
    InfoWindow: class {
      setContent() {}
      open() {}
    },
    marker: { AdvancedMarkerElement: StubAdvancedMarkerElement },
    event: {
      addListenerOnce: (_target: unknown, _name: string, handler: () => void) => handler(),
      trigger() {},
    },
  },
};

beforeEach(() => {
  clustererOptions.length = 0;
  vi.stubGlobal('google', stubGoogle);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ buildings: [] }), { status: 200 })),
  );
  // happy-dom has `navigator.geolocation` but it is null. The reader declines here.
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

async function mountMap() {
  const { default: BuildingMap } = await import('../../components/BuildingMap');
  render(<BuildingMap apiKey="test-key" />);
  await waitFor(() => expect(clustererOptions.length).toBe(1));
  const renderer = clustererOptions[0].renderer;
  if (!renderer) throw new Error('BuildingMap gave the clusterer no renderer');
  return renderer;
}

function drawCluster(renderer: Renderer, count: number) {
  // The island's renderer reads only `count` and `position`.
  const cluster = { count, position: { lat: 42.36, lng: -71.06 } };
  const marker = renderer.render(
    cluster as unknown as Parameters<Renderer['render']>[0],
    {} as Parameters<Renderer['render']>[1],
    {} as Parameters<Renderer['render']>[2],
  ) as unknown as StubAdvancedMarkerElement;
  return marker.options;
}

function legendRows(): HTMLElement[] {
  const heading = screen.getByText('Score Legend');
  const legend = heading.parentElement as HTMLElement;
  return [...legend.querySelectorAll<HTMLElement>('div.flex')];
}

/** "rgb(30, 41, 59)" or "#1e293b" -> "#1e293b". */
function toHex(color: string): string {
  const rgb = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!rgb) return color.toLowerCase();
  return `#${rgb.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

describe('map legend', () => {
  it('keeps the four score rows, then adds the cluster row last', async () => {
    await mountMap();
    const rows = legendRows();
    expect(rows.map((row) => row.textContent)).toEqual([
      'Good (4–5)',
      'Mixed (3–3.9)',
      'Concerning (2–2.9)',
      'Poor (1–1.9)',
      'Group of buildings',
    ]);
    expect(rows.at(-1)!.textContent).toBe(CLUSTER_LEGEND_LABEL);
  });

  it('draws the cluster swatch in the badge fill, not a score band colour', async () => {
    await mountMap();
    const row = legendRows().at(-1)!;
    const swatch = row.querySelector<HTMLElement>('span.rounded-full')!;
    expect(swatch.getAttribute('aria-hidden')).toBe('true');
    const fill = toHex(swatch.style.background || swatch.style.backgroundColor);
    expect(fill).toBe(CLUSTER_COLORS.fill.toLowerCase());
    const bandHexes = Object.values(SCORE_HEX).map((hex) => hex.toLowerCase());
    expect(bandHexes).not.toContain(fill);
    expect(swatch.style.boxShadow).not.toBe('');
  });

  it('sets the cluster row apart from the score rows with a rule', async () => {
    await mountMap();
    expect(legendRows().at(-1)!.className).toContain('border-t');
  });
});

describe('cluster badge on a stubbed map', () => {
  it('is titled with the count alone', async () => {
    const renderer = await mountMap();
    expect(drawCluster(renderer, 12).title).toBe('12 buildings');
    expect(drawCluster(renderer, 1).title).toBe('1 building');
  });

  it('shows the count in a dark round badge sized for that count', async () => {
    const renderer = await mountMap();
    const { content } = drawCluster(renderer, 12);
    expect(content).toBeInstanceOf(HTMLElement);
    expect(content!.textContent).toBe('12');
    const size = `${clusterBadgeSize(12)}px`;
    expect(content!.style.width).toBe(size);
    expect(content!.style.height).toBe(size);
    expect(toHex(content!.style.background || content!.style.backgroundColor)).toBe(
      CLUSTER_COLORS.fill.toLowerCase(),
    );
  });
});
