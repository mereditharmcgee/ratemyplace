import { useEffect, useMemo, useState } from 'preact/hooks';
import { COPY } from './copy';
import { fmtInt, type Core } from './compute';
import { loadOwner, loadOwnerIndex, type Buildings, type OwnerDetail, type OwnerIndex } from './data';
import type { DetailTarget } from './BuildingDetail';

interface Props { core: Core; buildings: Buildings | null; ownerId: number | null; onPick: (id: number | null) => void; onOpen: (t: DetailTarget) => void }
const MAX = 30;
const norm = (s: string) => s.toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const FLAG_LABEL = ['', COPY.labelPublic, COPY.labelSubsidized, COPY.labelCondoAssoc];

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
    hits.sort((a, b) => index.name[a].localeCompare(index.name[b]));
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
      {failed && <p class="error" role="alert">{COPY.loadError}</p>}
      {wanted && !index && !failed && <p class="loading" role="status">{COPY.ownerLoading}</p>}
      {ownerId === null && matches && index && (
        matches.length === 0 ? <p class="empty" role="status">{COPY.ownerNone}</p> : (
          <>
            <ul class="owner-results">
              {matches.slice(0, MAX).map((i) => (
                <li>
                  <button type="button" class="link-button" onClick={() => onPick(i)}>{index.name[i]}</button>
                  <span class="muted"> {fmtInt(index.n[i])} {index.n[i] === 1 ? COPY.ownerBuilding : COPY.ownerBuildings}</span>
                  {index.flag[i] > 0 && <span class="badge">{FLAG_LABEL[index.flag[i]]}</span>}
                </li>
              ))}
            </ul>
            {matches.length > MAX && <p class="muted" role="status">{fmtInt(matches.length - MAX)} {COPY.ownerMore}</p>}
          </>
        )
      )}
      {ownerId !== null && !owner && !failed && <p class="loading" role="status">{COPY.loading}</p>}
      {ownerId !== null && owner && (
        <div class="owner-card">
          <h3>{owner.name} {owner.flag > 0 && <span class="badge">{FLAG_LABEL[owner.flag]}</span>}</h3>
          <p class="sub">
            {fmtInt(new Set(owner.holdings.map((h) => h[0])).size)} {COPY.ownerBuildings}; {fmtInt(owner.holdings.filter((h) => h[6] + h[7] + h[8] > 0).length)} {COPY.ownerWithRecords}
          </p>
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
              <tbody>
                {[...owner.holdings].sort((a, b) => a[1].localeCompare(b[1], 'en', { numeric: true })).map((h) => (
                  <tr>
                    <th scope="row">
                      <button type="button" class="link-button" onClick={() => onOpen({ kind: 'holding', holding: h, ownerName: owner.name, ownerId })}>{h[1]}</button>
                      {h[9] > 0 && <span class="muted"> ({h[9]} {COPY.condoUnits})</span>}
                      {h[10] === 1 && <span class="muted"> ({COPY.labelCondoAssoc})</span>}
                    </th>
                    <td>{h[2]}</td>
                    <td class="n">{h[5] ?? ''}</td>
                    <td class="n">{fmtInt(h[6])}</td>
                    <td class="n">{fmtInt(h[7])}</td>
                    <td class="n">{fmtInt(h[8])}</td>
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
