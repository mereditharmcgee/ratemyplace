// The admin dashboard's "Waiting on you" counts: every intake queue that needs the owner.
//
// This is the safety net for owner notices. A notice can be capped, filtered to spam or lost;
// the count is read straight from the queues, so the backlog is visible either way.
//
// Contact messages are left out on purpose: they have no resolve action, so the count could
// never go back down.
import { logError } from '../logger';
import { OWNER_NOTICE_ADMIN_PATH } from '../ownerNotify';
import type { RecordsDb } from '../records/types';

export interface AdminInbox {
  reviewsPending: number;
  bugReportsOpen: number;
  correctionsPending: number;
  disputesPending: number;
  verificationsPending: number;
}

/** Display order, labels and the queue each count links to — the same links the notices use. */
export const ADMIN_INBOX_ROWS: Array<{ key: keyof AdminInbox; label: string; href: string }> = [
  { key: 'reviewsPending', label: 'Reviews to moderate', href: OWNER_NOTICE_ADMIN_PATH.review_submitted },
  { key: 'bugReportsOpen', label: 'Open bug reports', href: OWNER_NOTICE_ADMIN_PATH.bug_report },
  { key: 'correctionsPending', label: 'Record corrections', href: OWNER_NOTICE_ADMIN_PATH.record_correction },
  { key: 'disputesPending', label: 'Landlord disputes', href: OWNER_NOTICE_ADMIN_PATH.dispute },
  { key: 'verificationsPending', label: 'Tenancy documents to verify', href: OWNER_NOTICE_ADMIN_PATH.verification_upload },
];

interface InboxRow {
  reviews_pending: number | null;
  bug_reports_open: number | null;
  corrections_pending: number | null;
  disputes_pending: number | null;
  verifications_pending: number | null;
}

/**
 * One statement of scalar subqueries (D1 rejects large compound SELECTs). Null, not a throw,
 * when anything fails, so the dashboard can say "Could not load counts" and render the rest.
 */
export async function readAdminInbox(db: RecordsDb): Promise<AdminInbox | null> {
  try {
    const row = await db
      .prepare(
        'SELECT ' +
          "(SELECT COUNT(*) FROM reviews WHERE status = 'pending') AS reviews_pending, " +
          "(SELECT COUNT(*) FROM bug_reports WHERE status IN ('new', 'in_progress')) AS bug_reports_open, " +
          "(SELECT COUNT(*) FROM record_corrections WHERE status = 'pending') AS corrections_pending, " +
          "(SELECT COUNT(*) FROM disputes WHERE status = 'pending') AS disputes_pending, " +
          "(SELECT COUNT(*) FROM verification_images WHERE status = 'pending') AS verifications_pending",
      )
      .first<InboxRow>();
    if (!row) return null;
    return {
      reviewsPending: Number(row.reviews_pending ?? 0),
      bugReportsOpen: Number(row.bug_reports_open ?? 0),
      correctionsPending: Number(row.corrections_pending ?? 0),
      disputesPending: Number(row.disputes_pending ?? 0),
      verificationsPending: Number(row.verifications_pending ?? 0),
    };
  } catch (err) {
    logError('admin_inbox_failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
