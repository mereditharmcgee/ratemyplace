import { useEffect, useMemo, useState } from 'preact/hooks';
import { COPY } from './copy';
import { adjustedPerUnit, cityPerUnit, fmtInt, fmtPerUnit, perUnit, toCsv, type BuildingRow, type Core, type Filters } from './compute';
import { assessingUrl, FLAG, ISSUE_KEYS, type Buildings } from './data';
import { selectionLabel } from './Filters';

interface Props { core: Core; buildings: Buildings | null; rows: BuildingRow[]; filters: Filters; onOpen: (b: number) => void }
export type Sort = 'adjusted' | 'complaints' | 'perUnit' | 'citations' | 'cases' | 'units' | 'address' | 'owner';
const PAGE = 25;
const ADDRESS_ORDER = new Intl.Collator('en', { numeric: true });

/**
 * `cityRate` is the citywide complaints per unit for the chosen dates and issues. The default order ('adjusted')
 * uses each building's rate pulled toward it; every other order uses the number shown in its column.
 */
export function sortRows(rows: BuildingRow[], buildings: Buildings, sort: Sort, cityRate = 0, reverse = false): BuildingRow[] {
  // One shared collator: String.localeCompare with options builds a new one per call and is far slower.
  const byAddr = (a: BuildingRow, b: BuildingRow) => ADDRESS_ORDER.compare(buildings.addr[a.b], buildings.addr[b.b]);
  const byComplaints = (a: BuildingRow, b: BuildingRow) => b.complaints - a.complaints || b.citationDates - a.citationDates || byAddr(a, b);
  const units = (r: BuildingRow) => buildings.units[r.b];
  const out = [...rows];
  if (sort === 'address') out.sort(byAddr);
  else if (sort === 'owner') out.sort((a, b) => ADDRESS_ORDER.compare(buildings.ownerStrings[buildings.owner[a.b]], buildings.ownerStrings[buildings.owner[b.b]]) || byAddr(a, b));
  else if (sort === 'citations') out.sort((a, b) => b.citationDates - a.citationDates || b.complaints - a.complaints || byAddr(a, b));
  else if (sort === 'cases') out.sort((a, b) => buildings.isd[b.b] - buildings.isd[a.b] || byComplaints(a, b));
  else if (sort === 'units') out.sort((a, b) => (units(b) ?? -1) - (units(a) ?? -1) || byComplaints(a, b));
  else if (sort === 'perUnit') out.sort((a, b) => (perUnit(b.complaints, units(b)) ?? -1) - (perUnit(a.complaints, units(a)) ?? -1) || byComplaints(a, b));
  else if (sort === 'adjusted') {
    const adj = new Map(out.map((r) => [r.b, adjustedPerUnit(r.complaints, units(r), cityRate)] as const));
    out.sort((a, b) => adj.get(b.b)! - adj.get(a.b)! || byComplaints(a, b));
  } else out.sort(byComplaints);
  if (reverse) out.reverse();
  return out;
}

/** The download holds exactly the rows and numbers in the on-screen table, plus place columns and source links. */
export function tableCsv(core: Core, buildings: Buildings, rows: BuildingRow[]): string {
  const header = [COPY.address, COPY.district, COPY.neighborhood, COPY.zip, COPY.owner, COPY.units, COPY.complaints, COPY.perUnit,
    ...ISSUE_KEYS.map((k) => `${COPY.complaints}: ${COPY.issues[k]}`), COPY.citationDates, COPY.openCases, COPY.detailOwnerSource];
  const body = rows.map((r) => {
    const c = core.cells[buildings.cell[r.b]];
    return [buildings.addr[r.b], core.districts[c[0]] ?? '', core.neighborhoods[c[1]] ?? '', core.zips[c[2]] ?? '', buildings.ownerStrings[buildings.owner[r.b]],
      buildings.units[r.b] ?? '', r.complaints, fmtPerUnit(perUnit(r.complaints, buildings.units[r.b])), ...r.byGroup, r.citationDates, buildings.isd[r.b],
      (buildings.flags[r.b] & FLAG.hidden) !== 0 ? '' : assessingUrl(buildings.pid[r.b])];
  });
  return toCsv(header, body);
}

export function BuildingTable({ core, buildings, rows, filters, onOpen }: Props) {
  const [sort, setSort] = useState<Sort>('adjusted');
  const [reverse, setReverse] = useState(false);   // a second click on a column header flips its order
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows, sort, reverse]);
  const pick = (s: Sort) => { setReverse(s === sort ? !reverse : false); setSort(s); };
  const TEXT: Sort[] = ['address', 'owner'];       // these start A to Z; number columns start highest first
  const head = (s: Sort, label: string, numeric: boolean) => (
    <th scope="col" class={numeric ? 'n' : undefined}
      aria-sort={sort === s ? ((TEXT.includes(s) ? !reverse : reverse) ? 'ascending' : 'descending') : undefined}>
      <button type="button" class="th-sort" title={COPY.sortColumn} onClick={() => pick(s)}>{label}</button>
    </th>
  );
  const cityRate = useMemo(() => (buildings ? cityPerUnit(core, filters, buildings.units) : 0), [core, filters, buildings]);
  const sorted = useMemo(() => (buildings ? sortRows(rows, buildings, sort, cityRate, reverse) : []), [rows, buildings, sort, cityRate, reverse]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const shown = sorted.slice(page * PAGE, page * PAGE + PAGE);

  const download = () => {
    if (!buildings) return;
    const csv = `# ${COPY.pageTitle}. ${selectionLabel(core, filters)}. ${COPY.updated} ${core.meta.pulled}. ${COPY.source}: data.boston.gov\r\n` + tableCsv(core, buildings, sorted);
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `boston-housing-records-${core.meta.pulled}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div class="panel table-panel">
      <div class="panel-head">
        <h2>{COPY.tableHeading}</h2>
        <label class="inline">
          <span>{COPY.sortBy}</span>
          <select value={sort} onChange={(e) => { setReverse(false); setSort((e.target as HTMLSelectElement).value as Sort); }}>
            <option value="adjusted">{COPY.sortAdjusted}</option>
            <option value="complaints">{COPY.complaints}</option>
            <option value="perUnit">{COPY.perUnit}</option>
            <option value="citations">{COPY.citationDates}</option>
            <option value="cases">{COPY.openCases}</option>
            <option value="units">{COPY.units}</option>
            <option value="address">{COPY.address}</option>
            <option value="owner">{COPY.owner}</option>
          </select>
        </label>
      </div>
      {!buildings ? <p class="loading" role="status">{COPY.loading}</p> : sorted.length === 0 ? <p class="empty">{COPY.noBuildings}</p> : (
        <>
          <div class="table-scroll">
            <table id="buildings-table">
              <thead>
                <tr>
                  {head('address', COPY.address, false)}
                  {head('owner', COPY.owner, false)}
                  {head('units', COPY.units, true)}
                  {head('complaints', COPY.complaints, true)}
                  {head('perUnit', COPY.perUnit, true)}
                  {head('citations', COPY.citationDates, true)}
                  {head('cases', COPY.openCases, true)}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr>
                    <th scope="row"><button type="button" class="link-button" onClick={() => onOpen(r.b)} aria-label={`${COPY.viewRecords}: ${buildings.addr[r.b]}`}>{buildings.addr[r.b]}</button></th>
                    <td>{buildings.ownerStrings[buildings.owner[r.b]]}</td>
                    <td class="n">{buildings.units[r.b] ?? ''}</td>
                    <td class="n">{fmtInt(r.complaints)}</td>
                    <td class="n">{fmtPerUnit(perUnit(r.complaints, buildings.units[r.b]))}</td>
                    <td class="n">{fmtInt(r.citationDates)}</td>
                    <td class="n">{fmtInt(buildings.isd[r.b])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="pager">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>{COPY.prev}</button>
            <span role="status">{fmtInt(page * PAGE + 1)} to {fmtInt(Math.min(sorted.length, page * PAGE + PAGE))} {COPY.of} {fmtInt(sorted.length)} {COPY.buildings}</span>
            <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{COPY.next}</button>
          </div>
          <p class="tile-source">
            {COPY.source}: {['311', 'rentsmart', 'isd', 'assessment'].map((id, i) => <>{i > 0 && ', '}<a href={core.meta.sources[id].url} rel="noopener">{core.meta.sources[id].name}</a></>)}
          </p>
          <button type="button" class="button" onClick={download}>{COPY.download}</button>
        </>
      )}
    </div>
  );
}
