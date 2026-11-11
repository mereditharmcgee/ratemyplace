import { COPY } from './copy';
import { fmtChange, fmtInt, fmtPct, fmtRate, type Core, type Filters, type Summary } from './compute';

interface Props { core: Core; filters: Filters; summary: Summary; boston: Summary; showArea: boolean }

function Source({ core, id }: { core: Core; id: string }) {
  const s = core.meta.sources[id];
  return s ? <a href={s.url} rel="noopener">{s.name}</a> : null;
}

function Tile(props: { title: string; help: string; value: string; boston: string; showArea: boolean; detail: string; note?: string; sources: preact.ComponentChildren }) {
  return (
    <div class="tile">
      <h3>{props.title}</h3>
      <p class="tile-value">
        <span class="num">{props.value || COPY.notEnough}</span>
        {props.showArea && <span class="num-label">{COPY.thisArea}</span>}
      </p>
      {props.showArea && (
        <p class="tile-compare">
          <span class="num-small">{props.boston || COPY.notEnough}</span> {COPY.boston}
        </p>
      )}
      <p class="tile-detail">{props.detail}</p>
      <p class="tile-help">{props.help}{props.note ? ` ${props.note}` : ''}</p>
      <p class="tile-source">{COPY.source}: {props.sources}</p>
    </div>
  );
}

export function Tiles({ core, filters, summary: s, boston: b, showArea }: Props) {
  const issueOn = filters.issues.some(Boolean);
  const gy = s.growthYears;
  return (
    <section class="tiles" aria-label={COPY.tilesHeading}>
      <Tile
        title={COPY.tileRate} help={COPY.tileRateHelp} showArea={showArea}
        value={fmtRate(s.ratePerYear)} boston={fmtRate(b.ratePerYear)}
        detail={`${fmtInt(s.complaints)} ${COPY.complaintsCount}`}
        sources={<><Source core={core} id="311" />, <Source core={core} id="assessment" /></>}
      />
      <Tile
        title={COPY.tileCited} help={COPY.tileCitedHelp} note={issueOn ? COPY.citationsNotSplit : undefined} showArea={showArea}
        value={fmtPct(s.citedShare, 1)} boston={fmtPct(b.citedShare, 1)}
        detail={`${fmtInt(s.citedBuildings)} ${COPY.citedCount}`}
        sources={<><Source core={core} id="rentsmart" />, <Source core={core} id="assessment" /></>}
      />
      <Tile
        title={gy ? `${COPY.tileGrowth}, ${gy[0]} to ${gy[1]}` : COPY.tileGrowth} help={COPY.tileGrowthHelp} showArea={showArea}
        value={fmtChange(s.growth)} boston={fmtChange(b.growth)}
        detail={gy ? `${fmtInt(s.growthFrom)} (${gy[0]}), ${fmtInt(s.growthTo)} (${gy[1]})` : ''}
        sources={<Source core={core} id="rentsmart" />}
      />
    </section>
  );
}
