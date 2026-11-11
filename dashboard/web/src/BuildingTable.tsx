import { useEffect, useMemo, useState } from 'preact/hooks';
import { COPY } from './copy';
import { fmtInt, toCsv, type BuildingRow, type Core, type Filters } from './compute';
import { assessingUrl, FLAG, ISSUE_KEYS, type Buildings } from './data';
import { selectionLabel } from './Filters';

interface Props { core: Core; buildings: Buildings | null; rows: BuildingRow[]; filters: Filters; onOpen: (b: number) => void }
type Sort = 'complaints' | 'citations' | 'address';
const PAGE = 25;
const ADDRESS_ORDER = new Intl.Collator('en', { numeric: true });

export function sortRows(rows: BuildingRow[], buildings: Buildings, sort: Sort): BuildingRow[] {
  // One shared collator: String.localeCompare with options builds a new one per call and is far slower.
  const byAddr = (a: BuildingRow, b: BuildingRow) => ADDRESS_ORDER.compare(buildings.addr[a.b], buildings.addr[b.b]);
  const out = [...rows];
  if (sort === 'address') out.sort(byAddr);
  else if (sort === 'citations') out.sort((a, b) => b.citationDates - a.citationDates || b.complaints - a.complaints || byAddr(a, b));
  else out.sort((a, b) => b.complaints - a.complaints || b.citationDates - a.citationDates || byAddr(a, b));
  return out;
}

/** The download holds exactly the rows and numbers in the on-screen table, plus place columns and source links. */
export function tableCsv(core: Core, buildings: Buildings, rows: BuildingRow[]): string {
  const header = [COPY.address, COPY.district, COPY.neighborhood, COPY.zip, COPY.owner, COPY.units, COPY.complaints,
    ...ISSUE_KEYS.map((k) => `${COPY.complaints}: ${COPY.issues[k]}`), COPY.citationDates, COPY.openCases, COPY.detailOwnerSource];
  const body = rows.map((r) => {
    const c = core.cells[buildings.cell[r.b]];
    return [buildings.addr[r.b], core.districts[c[0]] ?? '', core.neighborhoods[c[1]] ?? '', core.zips[c[2]] ?? '', buildings.ownerStrings[buildings.owner[r.b]],
      buildings.units[r.b] ?? '', r.complaints, ...r.byGroup, r.citationDates, buildings.isd[r.b],
      (buildings.flags[r.b] & (FLAG.hidden | FLAG.withheld)) !== 0 ? '' : assessingUrl(buildings.pid[r.b])];
  });
  return toCsv(header, body);
}

export function BuildingTable({ core, buildings, rows, filters, onOpen }: Props) {
  const [sort, setSort] = useState<Sort>('complaints');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows, sort]);
  const sorted = useMemo(() => (buildings ? sortRows(rows, buildings, sort) : []), [rows, buildings, sort]);
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
          <select value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as Sort)}>
            <option value="complaints">{COPY.sortComplaints}</option>
            <option value="citations">{COPY.sortCitations}</option>
            <option value="address">{COPY.sortAddress}</option>
          </select>
        </label>
      </div>
      {!buildings ? <p class="loading" role="status">{COPY.loading}</p> : sorted.length === 0 ? <p class="empty">{COPY.noBuildings}</p> : (
        <>
          <div class="table-scroll">
            <table id="buildings-table">
              <thead>
                <tr>
                  <th scope="col">{COPY.address}</th>
                  <th scope="col">{COPY.owner}</th>
                  <th scope="col" class="n">{COPY.units}</th>
                  <th scope="col" class="n">{COPY.complaints}</th>
                  <th scope="col" class="n">{COPY.citationDates}</th>
                  <th scope="col" class="n">{COPY.openCases}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr>
                    <th scope="row"><button type="button" class="link-button" onClick={() => onOpen(r.b)} aria-label={`${COPY.viewRecords}: ${buildings.addr[r.b]}`}>{buildings.addr[r.b]}</button></th>
                    <td>{buildings.ownerStrings[buildings.owner[r.b]]}</td>
                    <td class="n">{buildings.units[r.b] ?? ''}</td>
                    <td class="n">{fmtInt(r.complaints)}</td>
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
