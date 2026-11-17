// Proof-of-address files in R2, removed when the review they prove is deleted.
//
// A file is normally deleted when an admin approves or rejects it (the decision route). A
// review deleted before that decision, on its own or with its building, would otherwise
// leave its file in R2 with no row pointing at it. The two admin delete routes call these
// helpers first: they look up the keys, delete the files, then delete the rows, and record
// the counts on their audit entry. A failed file delete never stops the admin's delete.
//
// Keys name the user and the review (`users/{userId}/verifications/{reviewId}/...`), and the
// filename is the user's own, so nothing here logs a key, a filename or a user id: a failure
// logs counts only.
import type { R2Bucket } from '@cloudflare/workers-types';
import { logError } from './logger';
import type { RecordsDb } from './records/types';
import { deleteVerificationImage } from './storage';

export interface VerificationFileRemoval {
  /** Deletes R2 accepted. A file already gone (deleted at its decision) counts here too. */
  removed: number;
  /** Deletes that threw, or files left because the bucket binding is missing. */
  failed: number;
}

/**
 * Every file key for one review, whatever its status. A decided row's file is normally gone
 * already, and deleting a missing key is a no-op, so including it costs nothing and also
 * clears a file whose delete failed at decision time.
 */
export async function verificationKeysForReview(db: RecordsDb, reviewId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT r2_key FROM verification_images WHERE review_id = ?')
    .bind(reviewId)
    .all<{ r2_key: string }>();
  return results.map((row) => row.r2_key);
}

/** Every file key for every review of one building (the building delete cascades to them). */
export async function verificationKeysForBuilding(db: RecordsDb, buildingId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT vi.r2_key FROM verification_images vi JOIN reviews r ON r.id = vi.review_id WHERE r.building_id = ?')
    .bind(buildingId)
    .all<{ r2_key: string }>();
  return results.map((row) => row.r2_key);
}

/** Delete the files. Never throws; a failure is logged with counts and the route name only. */
export async function removeVerificationFiles(
  bucket: R2Bucket | undefined,
  keys: readonly string[],
  endpoint: string,
): Promise<VerificationFileRemoval> {
  if (keys.length === 0) return { removed: 0, failed: 0 };
  if (!bucket) {
    logError('verification_files_delete_failed', { endpoint, reason: 'no_bucket', failed: keys.length, total: keys.length });
    return { removed: 0, failed: keys.length };
  }
  const results = await Promise.all(keys.map((key) => deleteVerificationImage(bucket, key)));
  const removed = results.filter(Boolean).length;
  const failed = keys.length - removed;
  if (failed > 0) {
    logError('verification_files_delete_failed', { endpoint, reason: 'r2_error', failed, total: keys.length });
  }
  return { removed, failed };
}
