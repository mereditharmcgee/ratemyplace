import { useEffect, useRef, useState } from 'preact/hooks';
import { COPY } from './copy';
import { dayLabel, fmtInt, type Core } from './compute';
import { assessingUrl, FLAG, ISSUE_COLORS, ISSUE_KEYS, loadRecords, rmpUrl, type BuildingRecords, type Buildings, type Holding } from './data';

/** A building opened from the map or table (by index), or from an owner's list (which may have no records). */
export type DetailTarget = { kind: 'index'; b: number } | { kind: 'holding'; holding: Holding; ownerName: string; ownerId: number };

interface Props { core: Core; buildings: Buildings | null; target: DetailTarget; onClose: () => void; onOwner: (id: number) => void }

export function BuildingDetail({ core, buildings, target, onClose, onOwner }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [rec, setRec] = useState<BuildingRecords | null | 'loading' | 'error'>('loading');

  // resolve to a building index when we can
  let b = -1;
  if (target.kind === 'index') b = target.b;
  else if (buildings) b = buildings.id.indexOf(target.holding[0]);
  const gis = target.kind === 'holding' ? target.holding[0] : buildings ? buildings.id[b] : '';

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    if (!gis) return;
    setRec('loading');
    let stale = false;
    loadRecords(gis, core.meta.recordShards).then((r) => { if (!stale) setRec(r); }).catch(() => { if (!stale) setRec('error'); });
    return () => { stale = true; };
  }, [gis, core]);

  const addr = b >= 0 && buildings ? buildings.addr[b] : target.kind === 'holding' ? target.holding[1] : '';
  const flags = b >= 0 && buildings ? buildings.flags[b] : 0;
  const cell = b >= 0 && buildings ? core.cells[buildings.cell[b]] : null;
  const place = cell
    ? [cell[0] >= 0 ? `${COPY.districtN} ${core.districts[cell[0]]}` : '', core.neighborhoods[cell[1]] ?? '', core.zips[cell[2]] ?? ''].filter(Boolean).join(', ')
    : target.kind === 'holding' ? [target.holding[2] ? `${COPY.districtN} ${target.holding[2]}` : '', target.holding[3], target.holding[4]].filter(Boolean).join(', ') : '';
  const units = b >= 0 && buildings ? buildings.units[b] : target.kind === 'holding' ? target.holding[5] : null;
  const ownerText = b >= 0 && buildings ? buildings.ownerStrings[buildings.owner[b]] : target.kind === 'holding' && !target.holding[9] ? target.ownerName : '';
  const oid = b >= 0 && buildings ? buildings.oid[b] : target.kind === 'holding' && !target.holding[9] ? target.ownerId : -1;
  const pid = b >= 0 && buildings ? buildings.pid[b] : gis;
  const hidden = (flags & FLAG.hidden) !== 0;
  const r = rec && typeof rec === 'object' ? rec : null;

  return (
    <dialog ref={ref} class="detail" aria-labelledby="detail-h" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div class="detail-body">
        <div class="detail-head">
          <div>
            <h2 id="detail-h">{addr}</h2>
            <p class="sub">{place}{units ? `. ${units} ${COPY.unitsEstimated}` : ''}{b >= 0 && buildings && buildings.ru[b] > 0 ? `, ${buildings.ru[b]} ${COPY.rentalUnits}` : ''}</p>
          </div>
          <button type="button" class="button ghost" onClick={() => ref.current?.close()}>{COPY.close}</button>
        </div>

        <div class="detail-owner">
          <h3>{COPY.detailOwner}</h3>
          {ownerText && <p class="owner-name">{ownerText}</p>}
          {hidden && <p class="tile-help">{COPY.individualOwnerHelp}</p>}
          <p class="badges">
            {(flags & FLAG.public) !== 0 && <span class="badge">{COPY.labelPublic}</span>}
            {(flags & FLAG.subsidized) !== 0 && <span class="badge">{COPY.labelSubsidized}</span>}
            {(flags & FLAG.condo) !== 0 && <span class="badge">{COPY.labelCondo}</span>}
            {(flags & FLAG.incomeRestricted) !== 0 && <span class="badge">{COPY.labelIncomeRestricted}</span>}
            {(flags & FLAG.problem) !== 0 && <span class="badge warn" title={COPY.labelProblemHelp}>{COPY.labelProblem}</span>}
            {(flags & FLAG.problemOwner) !== 0 && <span class="badge warn" title={COPY.labelProblemHelp}>{COPY.labelProblemOwner}</span>}
          </p>
          <p class="links">
            <a href={assessingUrl(pid)} rel="noopener">{COPY.detailOwnerSource}</a>
            {oid >= 0 && <button type="button" class="link-button" onClick={() => onOwner(oid)}>{COPY.detailSeeOwner}</button>}
            <a href={rmpUrl(addr)} rel="noopener">{COPY.rmpLink}</a>
          </p>
        </div>

        {rec === 'loading' && <p class="loading" role="status">{COPY.loading}</p>}
        {rec === 'error' && <p class="error" role="alert">{COPY.loadError}</p>}
        {rec === null && <p class="empty">{COPY.detailNoRecords}</p>}
        {r && (
          <>
            <RecordSection title={COPY.detailComplaints} count={r.c.length} source={core.meta.sources['311']}>
              <table>
                <thead><tr><th scope="col">{COPY.date}</th><th scope="col">{COPY.type}</th><th scope="col">{COPY.status}</th></tr></thead>
                <tbody>
                  {r.c.map(([day, type, g, status]) => (
                    <tr><td class="nowrap">{dayLabel(day)}</td><td><span class="dot" style={{ background: ISSUE_COLORS[g] }} title={COPY.issuesShort[ISSUE_KEYS[g]]} /> {type}</td><td>{status}</td></tr>
                  ))}
                </tbody>
              </table>
            </RecordSection>
            <RecordSection title={COPY.detailCitations} count={r.s.length} countLabel={COPY.citationDates.toLowerCase()} source={core.meta.sources.rentsmart}>
              <table>
                <thead><tr><th scope="col">{COPY.date}</th><th scope="col">{COPY.description}</th></tr></thead>
                <tbody>{r.s.map(([day, desc]) => <tr><td class="nowrap">{dayLabel(day)}</td><td>{desc.join('; ')}</td></tr>)}</tbody>
              </table>
            </RecordSection>
            <RecordSection title={COPY.detailCases} count={r.i.length} help={COPY.detailCasesHelp} source={core.meta.sources.isd}>
              <table>
                <thead><tr><th scope="col">{COPY.caseNo}</th><th scope="col">{COPY.status}</th><th scope="col">{COPY.date}</th><th scope="col">{COPY.description}</th></tr></thead>
                <tbody>
                  {r.i.map(([c, status, day, desc]) => <tr><td class="nowrap">{c}</td><td>{status}</td><td class="nowrap">{day ? dayLabel(day) : ''}</td><td>{desc.join('; ')}</td></tr>)}
                </tbody>
              </table>
            </RecordSection>
            {r.u.length > 0 && (
              <RecordSection title={COPY.detailUnitOwners} count={r.u.length} source={core.meta.sources.assessment}>
                <ul class="plain">
                  {r.u.map(([id, name, n]) => <li><button type="button" class="link-button" onClick={() => onOwner(id)}>{name}</button> ({n} {COPY.condoUnits})</li>)}
                </ul>
              </RecordSection>
            )}
          </>
        )}
        {b >= 0 && buildings && (
          <dl class="minor">
            <dt>{COPY.detailRodent}</dt><dd>{fmtInt(buildings.rod[b])} <a href={core.meta.sources['311'].url} rel="noopener">{COPY.source}</a></dd>
            <dt>{COPY.detailPwd}</dt><dd>{fmtInt(buildings.pwd[b])} <a href={core.meta.sources.pwd.url} rel="noopener">{COPY.source}</a></dd>
          </dl>
        )}
      </div>
    </dialog>
  );
}

function RecordSection(props: { title: string; count: number; countLabel?: string; help?: string; source: { name: string; url: string }; children: preact.ComponentChildren }) {
  return (
    <section class="rec">
      <h3>{props.title} <span class="count">{fmtInt(props.count)}{props.countLabel ? ` ${props.countLabel}` : ''}</span></h3>
      {props.help && <p class="tile-help">{props.help}</p>}
      {props.count === 0 ? <p class="empty small">{COPY.detailNone}</p> : <div class="table-scroll tall">{props.children}</div>}
      <p class="tile-source">{COPY.source}: <a href={props.source.url} rel="noopener">{props.source.name}</a></p>
    </section>
  );
}
