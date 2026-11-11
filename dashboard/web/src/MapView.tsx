import { useEffect, useRef } from 'preact/hooks';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { COPY } from './copy';
import { fmtInt, type BuildingRow, type Core, type Filters } from './compute';
import { CITATION_ONLY_COLOR, ISSUE_COLORS, ISSUE_KEYS, loadBoundaries, type Buildings } from './data';

interface Props { core: Core; buildings: Buildings; rows: BuildingRow[]; filters: Filters; onOpen: (b: number) => void }

// Kept in one place so the basemap can be swapped without touching the map code.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const BOSTON: L.LatLngBoundsExpression = [[42.227, -71.191], [42.397, -70.986]];

export default function MapView({ core, buildings, rows, filters, onOpen }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const dots = useRef<L.LayerGroup | null>(null);
  const outline = useRef<L.LayerGroup | null>(null);
  const open = useRef(onOpen);
  open.current = onOpen;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { preferCanvas: true, scrollWheelZoom: false, minZoom: 10, maxZoom: 18 });
    m.fitBounds(BOSTON);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(m);
    outline.current = L.layerGroup().addTo(m);
    dots.current = L.layerGroup().addTo(m);
    map.current = m;
    // scroll-wheel zoom only after a click, so the page still scrolls past the map
    m.on('click', () => m.scrollWheelZoom.enable());
    m.on('mouseout', () => m.scrollWheelZoom.disable());
    return () => { m.remove(); map.current = null; };
  }, []);

  // dots
  useEffect(() => {
    const m = map.current, layer = dots.current;
    if (!m || !layer) return;
    layer.clearLayers();
    const renderer = L.canvas({ padding: 0.3 });
    const pts: L.LatLngTuple[] = [];
    // draw the busiest buildings last so they sit on top
    const sorted = [...rows].sort((a, b) => a.complaints - b.complaints);
    for (const r of sorted) {
      const lat = buildings.lat[r.b], lon = buildings.lon[r.b];
      if (lat === null || lon === null) continue;
      pts.push([lat, lon]);
      const color = r.top >= 0 ? ISSUE_COLORS[r.top] : CITATION_ONLY_COLOR;
      const mk = L.circleMarker([lat, lon], {
        renderer, radius: 4 + Math.min(7, Math.sqrt(r.complaints)), fillColor: color, fillOpacity: 0.85, color: '#1e293b', weight: 0.75,
      });
      mk.on('click', () => open.current(r.b));
      mk.on('mouseover', () => {
        const issue = r.top >= 0 ? COPY.issuesShort[ISSUE_KEYS[r.top]] : COPY.mapLegendCitation;
        mk.bindTooltip(`<strong>${escapeHtml(buildings.addr[r.b])}</strong><br>${fmtInt(r.complaints)} ${COPY.complaintsCount}, ${fmtInt(r.citationDates)} ${COPY.citationDates.toLowerCase()}<br>${escapeHtml(issue)}`).openTooltip();
      });
      mk.addTo(layer);
    }
    const geo = filters.district >= 0 || filters.neighborhood >= 0 || filters.zip >= 0;
    if (geo && pts.length) m.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 16 });
    else if (!geo) m.fitBounds(BOSTON);
  }, [rows, buildings, filters.district, filters.neighborhood, filters.zip]);

  // outline of the selected district or neighborhood
  useEffect(() => {
    const layer = outline.current;
    if (!layer) return;
    layer.clearLayers();
    if (filters.district < 0 && filters.neighborhood < 0) return;
    let stale = false;
    loadBoundaries().then((b) => {
      if (stale) return;
      const draw = (rings: number[][][]) => rings.forEach((ring) =>
        L.polygon(ring.map(([x, y]) => [y, x] as L.LatLngTuple), { color: '#0F766E', weight: 2, fill: false, interactive: false }).addTo(layer));
      if (filters.district >= 0) b.districts.filter((d) => d.name === core.districts[filters.district]).forEach((d) => draw(d.rings));
      if (filters.neighborhood >= 0) b.neighborhoods.filter((n) => n.name === core.neighborhoods[filters.neighborhood]).forEach((n) => draw(n.rings));
    }).catch(() => undefined);
    return () => { stale = true; };
  }, [core, filters.district, filters.neighborhood]);

  return (
    <>
      <div ref={el} class="map" role="application" aria-label={`${COPY.mapHeading}. ${COPY.tableHeading}: ${fmtInt(rows.length)}`} />
      <ul class="map-legend">
        {ISSUE_KEYS.map((k, i) => <li><span class="dot" style={{ background: ISSUE_COLORS[i] }} /> {COPY.issuesShort[k]}</li>)}
        <li><span class="dot" style={{ background: CITATION_ONLY_COLOR }} /> {COPY.mapLegendCitation}</li>
      </ul>
      <p class="tile-source">{fmtInt(rows.length)} {COPY.mapTooMany}</p>
    </>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
