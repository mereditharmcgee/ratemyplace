import { useMemo, useState } from 'preact/hooks';
import { COPY } from './copy';
import { fmtInt, monthLabel, trend, type Core, type Filters, type TrendPoint } from './compute';

interface Props { core: Core; filters: Filters; mask: boolean[]; showArea: boolean }

const W = 720, H = 280, PAD = { l: 44, r: 96, t: 16, b: 34 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 2, 2.5, 5, 10]) if (v <= k * p) return k * p;
  return 10 * p;
}

export function Trend({ core, filters, mask, showArea }: Props) {
  const [metric, setMetric] = useState<'complaints' | 'cited'>('complaints');
  const [by, setBy] = useState<'month' | 'year'>('year');
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const pts = useMemo(() => trend(core, filters, mask, metric, by), [core, filters, mask, metric, by]);
  const label = (p: TrendPoint) => (by === 'month' ? monthLabel(p.label) : p.label) + (p.partial ? ` (${COPY.partial})` : '');
  const axis = metric === 'complaints' ? COPY.trendComplaintsAxis : COPY.trendCitedAxis;
  const srcId = metric === 'complaints' ? '311' : 'rentsmart';

  const max = niceMax(Math.max(...pts.map((p) => Math.max(p.bostonRate ?? 0, showArea ? p.rate ?? 0 : 0))));
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const path = (get: (p: TrendPoint) => number | null) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(get(p) ?? 0).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const step = Math.max(1, Math.ceil(pts.length / 8));
  const last = pts.length - 1;
  // keep the two end labels from sitting on top of each other
  const yA = y(pts[last]?.rate ?? 0), yB0 = y(pts[last]?.bostonRate ?? 0);
  const yB = showArea && Math.abs(yA - yB0) < 14 ? yA + (yB0 >= yA ? 14 : -14) : yB0;

  const onMove = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = pts.length === 1 ? 0 : Math.round(((px - PAD.l) / iw) * (pts.length - 1));
    setHover(Math.max(0, Math.min(last, i)));
  };
  const h = hover !== null && hover <= last ? pts[hover] : null;
  const fmt = (v: number | null) => (v === null ? '' : v.toFixed(v < 10 ? 2 : 1));

  return (
    <section class="panel trend" aria-labelledby="trend-h">
      <div class="panel-head">
        <h2 id="trend-h">{COPY.trendHeading}</h2>
        <div class="seg" role="group" aria-label={COPY.trendHeading}>
          <button type="button" aria-pressed={metric === 'complaints'} onClick={() => setMetric('complaints')}>{COPY.trendComplaints}</button>
          <button type="button" aria-pressed={metric === 'cited'} onClick={() => setMetric('cited')}>{COPY.trendCited}</button>
        </div>
        <div class="seg" role="group" aria-label={COPY.period}>
          <button type="button" aria-pressed={by === 'year'} onClick={() => setBy('year')}>{COPY.byYear}</button>
          <button type="button" aria-pressed={by === 'month'} onClick={() => setBy('month')}>{COPY.byMonth}</button>
        </div>
      </div>
      <p class="sub">{axis}</p>
      <div class="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${axis}. ${COPY.showTable}.`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} class="grid" />
              <text x={PAD.l - 8} y={y(t) + 4} text-anchor="end" class="tick">{Number(t.toFixed(2)).toString()}</text>
            </g>
          ))}
          {pts.map((p, i) => (i % step === 0 || i === last) && (i === last || last - i >= step * 0.6) && (
            <text x={x(i)} y={H - 10} text-anchor="middle" class="tick">{by === 'month' ? monthLabel(p.label).replace(' 20', " '") : p.partial ? `${p.label} (${COPY.partial})` : p.label}</text>
          ))}
          <path d={path((p) => p.bostonRate)} class={showArea ? 'line boston' : 'line area'} />
          {showArea && <path d={path((p) => p.rate)} class="line area" />}
          {(by === 'year' || pts.length <= 12) && pts.map((p, i) => (
            <g>
              <circle cx={x(i)} cy={y(p.bostonRate ?? 0)} r="4" class={showArea ? 'pt boston' : 'pt area'} />
              {showArea && <circle cx={x(i)} cy={y(p.rate ?? 0)} r="4" class="pt area" />}
            </g>
          ))}
          {pts.length > 0 && (
            <>
              <text x={x(last) + 10} y={yB + 4} class="end-label">{COPY.boston}</text>
              {showArea && <text x={x(last) + 10} y={yA + 4} class="end-label strong">{COPY.thisArea}</text>}
            </>
          )}
          {h && hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} class="cross" />}
        </svg>
        {h && hover !== null && (
          <div class="tip" style={{ left: `${(x(hover) / W) * 100}%` }} role="presentation">
            <strong>{label(h)}</strong>
            {showArea && <span><i class="sw area" /> {COPY.thisArea}: {fmt(h.rate)} ({fmtInt(h.count)})</span>}
            <span><i class={showArea ? 'sw boston' : 'sw area'} /> {COPY.boston}: {fmt(h.bostonRate)} ({fmtInt(h.bostonCount)})</span>
          </div>
        )}
      </div>
      {showArea && (
        <p class="legend">
          <span><i class="sw area" /> {COPY.thisArea}</span>
          <span><i class="sw boston" /> {COPY.boston}</span>
        </p>
      )}
      <p class="tile-source">
        {COPY.source}: <a href={core.meta.sources[srcId].url} rel="noopener">{core.meta.sources[srcId].name}</a>, <a href={core.meta.sources.assessment.url} rel="noopener">{core.meta.sources.assessment.name}</a>
        {' '}<button type="button" class="link-button" aria-expanded={table} onClick={() => setTable(!table)}>{table ? COPY.hideTable : COPY.showTable}</button>
      </p>
      {table && (
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{COPY.period}</th>
                {showArea && <th scope="col" class="n">{COPY.thisArea}: {metric === 'complaints' ? COPY.trendComplaints : COPY.trendCited}</th>}
                {showArea && <th scope="col" class="n">{COPY.thisArea}: {axis}</th>}
                <th scope="col" class="n">{COPY.boston}: {metric === 'complaints' ? COPY.trendComplaints : COPY.trendCited}</th>
                <th scope="col" class="n">{COPY.boston}: {axis}</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((p) => (
                <tr>
                  <th scope="row">{label(p)}</th>
                  {showArea && <td class="n">{fmtInt(p.count)}</td>}
                  {showArea && <td class="n">{fmt(p.rate)}</td>}
                  <td class="n">{fmtInt(p.bostonCount)}</td>
                  <td class="n">{fmt(p.bostonRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
