import { useEffect, useMemo, useState } from 'preact/hooks';
import { COPY } from './copy';
import { fmtInt, plural, type Core } from './compute';
import { loadOwner, loadOwnerIndex, type Buildings, type OwnerDetail, type OwnerIndex } from './data';
import type { DetailTarget } from './BuildingDetail';

interface Props { core: Core; buildings: Buildings | null; ownerId: number | null; onPick: (id: number | null) => void; onOpen: (t: DetailTarget) => void }
const MAX = 30;
const norm = (s: string) => s.toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// someone typing a street address into the owner box: a number then a word, or a last word that is a street type
const looksLikeAddress = (s: string) => /^\s*\d+[a-z]?(-\d+)?\s+[a-z]/i.test(s) || /\s(st|street|av|ave|avenue|rd|road|pl|place|ter|terrace|ct|court|dr|drive|way|sq|square)\.?\s*$/i.test(s);
const toFindBox = () => { const el = document.getElementById('find-building'); el?.scrollIntoView({ block: 'center' }); el?.focus(); };
const FLAG_LABEL = ['', COPY.labelPublic, COPY.labelSubsidized, COPY.labelCondoAssoc];

/** The line under an owner's name. Buildings where the owner only holds condo units are not counted as theirs. */
export function ownerSummary(owner: OwnerDetail): string {
  const own = owner.holdings.filter((h) => !h[9]);
  const nb = new Set(own.map((h) => h[0])).size;
  const units = owner.holdings.reduce((t, h) => t + h[9], 0);
  const parts: string[] = [];
  if (nb > 0 || units === 0) parts.push(`${fmtInt(nb)} ${plural(nb, COPY.ownerBuildings)}; ${fmtInt(own.filter((h) => h[6] + h[7] + h[8] > 0).length)} ${COPY.ownerWithRecords}`);
  if (units > 0) parts.push(`${fmtInt(units)} ${plural(units, COPY.ownerUnitsHeld)}`);
  return parts.join('. ');
}

export function OwnerLookup({ core, ownerId, onPick, onOpen }: Props) {
  const [index, setIndex] = useState<OwnerIndex | null>(null);
  const [wanted, setWanted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState<OwnerDetail | null>(null);

  useEffect(() => {
    if ((wanted || ownerId !== null) && !index) loadOwnerIndex().then(setIndex).catch(() => setFailed(true));
  }, [wanted, ownerId, index]);
  const normed = useMemo(() => (index ? index.name.map(norm) : []), [index]);

  useEffect(() => {
    setOwner(null);
    if (ownerId === null) return;
    let stale = false;
    loadOwner(ownerId, core.meta.ownerShards).then((o) => { if (!stale) setOwner(o); }).catch(() => setFailed(true));
    return () => { stale = true; };
  }, [ownerId, core]);

  const matches = useMemo(() => {
    const tokens = norm(q).split(' ').filter(Boolean);
    if (!index || tokens.join('').length < 2) return null;
    const hits: number[] = [];
    for (let i = 0; i < normed.length; i++) if (tokens.every((t) => normed[i].includes(t))) hits.push(i);
    // alphabetical, never ordered by record counts
    hits.sort((a, b) => (index.name[a] < index.name[b] ? -1 : index.name[a] > index.name[b] ? 1 : 0));
    return hits;
  }, [q, index, normed]);

  return (
    <section class="panel owners" id="owners" aria-labelledby="owners-h">
      <h2 id="owners-h">{COPY.ownerHeading}</h2>
      <p class="sub">{COPY.ownerSub}</p>
      <label class="search">
        <span>{COPY.ownerInput}</span>
        <input
          type="search" value={q} placeholder={COPY.ownerPlaceholder} autocomplete="off" spellcheck={false}
          onFocus={() => setWanted(true)}
          onInput={(e) => { setWanted(true); setQ((e.target as HTMLInputElement).value); if (ownerId !== null) onPick(null); }}
        />
      </label>
      {looksLikeAddress(q) && (
        <p class="find-none" id="owner-address-hint" role="status"><span>{COPY.ownerAddressHint} </span><button type="button" class="link-button" onClick={toFindBox}>{COPY.findBuilding}</button><span>.</span></p>
      )}
      {failed && <p class="error" role="alert">{COPY.loadError}</p>}
      {wanted && !index && !failed && <p class="loading" role="status">{COPY.ownerLoading}</p>}
      {ownerId === null && matches && index && (
        matches.length === 0 ? <p class="empty" role="status">{COPY.ownerNone}</p> : (
          <>
            <ul class="owner-results" translate={false}>
              {matches.slice(0, MAX).map((i) => (
                <li>
                  <button type="button" class="link-button" onClick={() => onPick(i)}>{index.name[i]}</button>
                  <span class="muted"> {[
                    index.n[i] > 0 || !index.u[i] ? `${fmtInt(index.n[i])} ${plural(index.n[i], COPY.ownerBuildings)}` : '',
                    index.u[i] > 0 ? `${fmtInt(index.u[i])} ${plural(index.u[i], COPY.condoUnits)}` : '',
                  ].filter(Boolean).join(', ')}</span>
                  {index.flag[i] > 0 && <span class="badge">{FLAG_LABEL[index.flag[i]]}</span>}
                </li>
              ))}
            </ul>
            {matches.length > MAX && <p class="muted" role="status" translate={false}>{fmtInt(matches.length - MAX)} {plural(matches.length - MAX, COPY.ownerMore)}</p>}
          </>
        )
      )}
      {ownerId !== null && !owner && !failed && <p class="loading" role="status">{COPY.loading}</p>}
      {ownerId !== null && owner && (
        <div class="owner-card">
          <h3><span translate={false}>{owner.name}</span> {owner.flag > 0 && <span class="badge">{FLAG_LABEL[owner.flag]}</span>}</h3>
          <p class="sub" translate={false} id="owner-summary">{ownerSummary(owner)}</p>
          {owner.spellings.length > 1 && <p class="tile-help">{COPY.ownerSpellings}: {owner.spellings.join('; ')}</p>}
          <div class="table-scroll">
            <table id="owner-table">
              <thead>
                <tr>
                  <th scope="col">{COPY.address}</th>
                  <th scope="col">{COPY.ownerDistrict}</th>
                  <th scope="col" class="n">{COPY.units}</th>
                  <th scope="col" class="n">{COPY.complaints}</th>
                  <th scope="col" class="n">{COPY.citationDates}</th>
                  <th scope="col" class="n">{COPY.openCases}</th>
                </tr>
              </thead>
              <tbody translate={false}>
                {[...owner.holdings].sort((a, b) => a[1].localeCompare(b[1], 'en', { numeric: true })).map((h) => (
                  <tr>
                    <th scope="row">
                      <button type="button" class="link-button" onClick={() => onOpen({ kind: 'holding', holding: h, ownerName: owner.name, ownerId })}>{h[1]}</button>
                      {h[9] > 0 && <span class="muted"> {h[9] === 1 ? COPY.ownerOwnsUnit : `${COPY.ownerOwns} ${fmtInt(h[9])} ${COPY.ownerOwnsUnits}`}</span>}
                      {h[10] === 1 && <span class="muted"> ({COPY.labelCondoAssoc})</span>}
                    </th>
                    <td>{h[2]}</td>
                    {/* a condo unit owner's row carries no building-wide numbers: they belong to the whole building */}
                    {h[9] > 0 ? <td colSpan={4} class="unit-row-note">{COPY.ownerUnitRecordsNote}</td> : (
                      <>
                        <td class="n">{h[5] ?? ''}</td>
                        <td class="n">{fmtInt(h[6])}</td>
                        <td class="n">{fmtInt(h[7])}</td>
                        <td class="n">{fmtInt(h[8])}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="tile-source">
            {COPY.source}: {['assessment', '311', 'rentsmart', 'isd'].map((id, i) => <>{i > 0 && ', '}<a href={core.meta.sources[id].url} rel="noopener">{core.meta.sources[id].name}</a></>)}
          </p>
        </div>
      )}
    </section>
  );
}
