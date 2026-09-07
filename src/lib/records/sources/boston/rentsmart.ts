// CKAN's SQL endpoint has no parameter binding, so this module is the repo's documented
// exception to "parameterized queries always" (see AGENTS.md). The invariant that keeps
// it safe: every interpolated value passes through `sqlLiteral`, and every identifier
// (table/column name) is a code constant, never user input.
//
// RentSmart is the city's roll-up of housing-related complaints and requests, keyed on
// `parcel` (text) rather than address, so unlike the address-matched feeds elsewhere in
// this directory this source has nothing to query on when the building has no parcel.
//
// CKAN's `_id` is a row number assigned by the datastore, not a stable record key: a
// wholesale reload of this resource reassigns `_id` for every row. That's fine for
// storage — pull.ts replaces this source's rows wholesale on every pull, so nothing here
// depends on `_id` surviving between pulls — but a re-pull diff must compare RentSmart
// rows on payload content, not on `sourceKey` (which is `_id`), or every dataset reload
// will look like an entirely new set of records.
import { ckanSql, ROW_CAP, sqlLiteral, textOrNull } from '../../ckan';
import type { RecordSource, RentSmartPayload, SourceResult } from '../../types';

export const RENTSMART_RESOURCE_ID = 'dc615ff7-2ff3-416a-922b-f0f334f085d0';
export const RENTSMART_PAGE_URL = 'https://data.boston.gov/dataset/rentsmart';

type Row = Record<string, string | number | null>;

const COLUMNS = ['_id', 'date', 'violation_type', 'description', 'address', 'parcel'];

export const rentsmartSource: RecordSource = {
  id: RENTSMART_RESOURCE_ID,
  label: 'RentSmart',
  pageUrl: RENTSMART_PAGE_URL,
  kinds: ['rentsmart'],
  async run(identity, fetchImpl): Promise<SourceResult> {
    const parcelForms = Array.from(new Set([identity.parcelId, identity.parcelNumeric].filter((p): p is string => Boolean(p))));
    if (parcelForms.length === 0) {
      // An empty result still runs the delete side of pull.ts's replace-per-source write
      // (see replaceStatements), so this is how a building that lost its parcel — or
      // turned out to be a condo with no whole-building parcel — gets stale RentSmart
      // rows from a previous pull cleared instead of left behind.
      return identity.condominium
        ? { query: 'condominium: no whole-building parcel, RentSmart skipped', rows: [] }
        : { query: 'no parcel: RentSmart skipped', rows: [] };
    }
    const sql =
      `SELECT ${COLUMNS.map((c) => `"${c}"`).join(',')} FROM "${RENTSMART_RESOURCE_ID}" ` +
      `WHERE "parcel" IN (${parcelForms.map(sqlLiteral).join(',')}) ` +
      // The cap is applied (by ckanSql, via ROW_CAP) before dedupe below, so the tiebreak
      // order here determines which rows survive the cap and which duplicate survives dedupe.
      `ORDER BY "date" DESC, "_id" LIMIT ${ROW_CAP}`;
    const rows = await ckanSql<Row>(sql, fetchImpl);
    const seen = new Set<string>();
    const out: SourceResult['rows'] = [];
    for (const row of rows) {
      const rowId = textOrNull(row._id);
      if (!rowId || seen.has(rowId)) continue;
      seen.add(rowId);
      const payload: RentSmartPayload = {
        rowId,
        date: textOrNull(row.date),
        violationType: textOrNull(row.violation_type),
        description: textOrNull(row.description),
        address: textOrNull(row.address),
        parcel: textOrNull(row.parcel),
      };
      out.push({ kind: 'rentsmart', sourceKey: rowId, payload, sourceUrl: RENTSMART_PAGE_URL });
    }
    return { query: sql, rows: out };
  },
};
