import { COPY } from './copy';
import { fmtChange, fmtInt, fmtPct, fmtRate, plural, type Core, type Filters, type Summary } from './compute';

interface Props { core: Core; filters: Filters; summary: Summary; boston: Summary; showArea: boolean; place: string }

function Source({ core, id }: { core: Core; id: string }) {
  const s = core.meta.sources[id];
  return s ? <a href={s.url} rel="noopener">{s.name}</a> : null;
}

/** One labelled count under a tile's headline number: the number, then what it counts. */
type Count = { n: string; label: string };

// Numbers and place names carry translate={false}, and wording that changes is keyed so it is replaced whole. A page
// translator swaps text nodes for its own elements; without this the page would go on updating nodes nobody can see.
function Tile(props: { title: string; help: string; value: string; boston: string; showArea: boolean; place: string; counts: Count[]; note?: string; sources: preact.ComponentChildren }) {
  return (
    <div class="tile">
      <h3 key={props.title}>{props.title}</h3>
      <p class="tile-value">
        <span class="num" translate={false} key={props.value ? 'n' : 'none'}>{props.value || COPY.notEnough}</span>
        {props.showArea && <span class="num-label" translate={false}>{props.place}</span>}
      </p>
      {props.showArea && (
        <p class="tile-compare">
          <span class="num-small" translate={false} key={props.boston ? 'n' : 'none'}>{props.boston || COPY.notEnough}</span> <span>{COPY.boston}</span>
        </p>
      )}
      {props.counts.map((c) => (
        <p class="tile-detail"><span class="num-small" translate={false}>{c.n}</span> <span key={c.label}>{c.label}</span></p>
      ))}
      <p class="tile-help"><span>{props.help}</span>{props.note && <span> {props.note}</span>}</p>
      <p class="tile-source"><span>{COPY.source}: </span>{props.sources}</p>
    </div>
  );
}

export function Tiles({ core, filters, summary: s, boston: b, showArea, place }: Props) {
  const issueOn = filters.issues.some(Boolean);
  const gy = s.growthYears;
  return (
    <>
      <p class="scope-note">{COPY.allOwnersNote}</p>
      <section class="tiles" aria-label={COPY.tilesHeading}>
        <Tile
          title={COPY.tileRate} help={COPY.tileRateHelp} showArea={showArea} place={place}
          value={fmtRate(s.ratePerYear)} boston={fmtRate(b.ratePerYear)}
          counts={[
            { n: fmtInt(s.rentalComplaints), label: `${plural(s.rentalComplaints, COPY.complaintsCount)}: ${COPY.tileCountRate}` },
            { n: fmtInt(s.complaints), label: `${plural(s.complaints, COPY.complaintsCount)}: ${COPY.tileCountAll}` },
          ]}
          sources={<><Source core={core} id="311" /><span>, </span><Source core={core} id="assessment" /></>}
        />
        <Tile
          title={COPY.tileCited} help={COPY.tileCitedHelp} note={issueOn ? COPY.citationsNotSplit : undefined} showArea={showArea} place={place}
          value={fmtPct(s.citedShare, 1)} boston={fmtPct(b.citedShare, 1)}
          counts={[
            { n: fmtInt(s.citedRental), label: `${plural(s.citedRental, COPY.citedCount)}: ${COPY.tileCountShare}` },
            { n: fmtInt(s.citedBuildings), label: `${plural(s.citedBuildings, COPY.citedCount)}: ${COPY.tileCountAll}` },
          ]}
          sources={<><Source core={core} id="rentsmart" /><span>, </span><Source core={core} id="assessment" /></>}
        />
        <Tile
          title={gy ? `${COPY.tileGrowth}, ${gy[0]} to ${gy[1]}` : COPY.tileGrowth} help={COPY.tileGrowthHelp} showArea={showArea} place={place}
          value={fmtChange(s.growth)} boston={fmtChange(b.growth)}
          counts={gy ? [{ n: `${fmtInt(s.growthFrom)} (${gy[0]}), ${fmtInt(s.growthTo)} (${gy[1]})`, label: COPY.tileGrowthScope }] : []}
          sources={<Source core={core} id="rentsmart" />}
        />
      </section>
    </>
  );
}
