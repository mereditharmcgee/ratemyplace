// Limits and validation for the reader-facing records request. The route in
// `src/pages/api/records/request.ts` is the only writer; keep the numbers here so the test,
// the privacy page, and the route agree.
import type { ValidationError } from '../validation';
import type { RecordsDb } from './types';

/** Per-IP: three presses an hour. The same shape as the correction form's limit. */
export const REQUEST_PER_IP = 3;
export const REQUEST_WINDOW_SECONDS = 3600;
/** Site-wide: 300 button rows a day, counted from `records_queue` (button rows are never purged). */
export const REQUEST_DAILY_CAP = 300;
export const REQUEST_CAP_WINDOW_SECONDS = 86_400;

export async function buttonRequestsSince(db: RecordsDb, since: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM records_queue WHERE reason = 'button' AND requested_at >= ?")
    .bind(since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export function validateRequestBody(body: Record<string, unknown>): ValidationError[] {
  const { buildingId } = body;
  if (!buildingId || typeof buildingId !== 'string' || !buildingId.trim()) {
    return [{ field: 'buildingId', message: 'Building is required.' }];
  }
  return [];
}
