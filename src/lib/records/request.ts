// Limits and validation for the reader-facing records request. The route in
// `src/pages/api/records/request.ts` is the only writer; keep the numbers here so the route,
// its tests, and the privacy-page copy cannot fork.
import type { ValidationError } from '../validation';
import type { RecordsDb } from './types';

/** Per-IP: three presses an hour. The same shape as the correction form's limit. */
export const REQUEST_PER_IP = 3;
export const REQUEST_WINDOW_SECONDS = 3600;
/** Site-wide: 300 button rows a day, counted from `records_queue` (button rows are never purged). */
export const REQUEST_DAILY_CAP = 300;
export const REQUEST_CAP_WINDOW_SECONDS = 86_400;

export async function buttonRequestsSince(db: RecordsDb, since: number): Promise<{ count: number; oldest: number | null }> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n, MIN(requested_at) AS oldest FROM records_queue WHERE reason = 'button' AND requested_at >= ?")
    .bind(since)
    .first<{ n: number; oldest: number | null }>();
  return { count: row?.n ?? 0, oldest: row?.oldest ?? null };
}

export type ParsedRequestBody = { errors: ValidationError[]; buildingId: null } | { errors: []; buildingId: string };
export function parseRequestBody(body: Record<string, unknown>): ParsedRequestBody {
  const { buildingId } = body;
  if (typeof buildingId !== 'string' || !buildingId.trim()) {
    return { errors: [{ field: 'buildingId', message: 'Building is required.' }], buildingId: null };
  }
  return { errors: [], buildingId: buildingId.trim() };
}
