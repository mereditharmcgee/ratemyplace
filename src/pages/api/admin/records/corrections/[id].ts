import type { APIContext, APIRoute } from 'astro';
import { getDB } from '../../../../../lib/db';
import { getEnv, fireAndForget } from '../../../../../lib/runtime';
import { createAuditLog } from '../../../../../lib/audit';
import { getClientIP } from '../../../../../lib/rateLimit';
import { logError } from '../../../../../lib/logger';
import { sanitizeMultilineText } from '../../../../../lib/validation';
import { sendRecordCorrectionOutcomeEmail } from '../../../../../lib/email';
import { CORRECTION_RESOLUTIONS, type CorrectionResolution } from '../../../../../lib/records/corrections';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function validationError(field: string, message: string): Response {
  return json({ error: 'Validation failed', details: [{ field, message }] }, 400);
}

const NOTES_MAX = 1000;
const MISMATCH_NOTES_MIN = 10;

interface CorrectionRow {
  building_id: string;
  contact_email: string | null;
  status: string;
  building_address: string;
  building_slug: string;
}

/**
 * PATCH /api/admin/records/corrections/:id
 *
 * Close a public-record correction report. Every resolution asserts something
 * about a re-pull, so the route refuses to run until at least one `record_pulls`
 * row carries this correction's id: an admin cannot close a report by declaring
 * an outcome they never checked.
 *
 * `source_mismatch_noted` is the one outcome that leaves the page disagreeing
 * with the filer, so it requires a public note explaining the disagreement.
 */
export const PATCH: APIRoute = async (context: APIContext) => {
  const user = context.locals.user;
  if (!user?.isAdmin) {
    return json({ error: 'Admin access required' }, 403);
  }

  const correctionId = context.params.id;
  if (!correctionId) {
    return json({ error: 'Correction ID required' }, 400);
  }

  try {
    // A non-JSON or malformed body is treated as an empty one so it falls through
    // to the resolution validation error below, not a raw SyntaxError → 500.
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await context.request.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      body = {};
    }

    const rawResolution = body.resolution;
    if (
      typeof rawResolution !== 'string' ||
      !(CORRECTION_RESOLUTIONS as readonly string[]).includes(rawResolution)
    ) {
      return validationError('resolution', 'Choose a resolution.');
    }
    const resolution = rawResolution as CorrectionResolution;

    const notes = sanitizeMultilineText(String(body.notes ?? ''));
    if (resolution === 'source_mismatch_noted' && notes.length < MISMATCH_NOTES_MIN) {
      return validationError(
        'notes',
        `A source mismatch needs a public note of at least ${MISMATCH_NOTES_MIN} characters.`,
      );
    }
    if (notes.length > NOTES_MAX) {
      return validationError('notes', `Keep notes under ${NOTES_MAX} characters.`);
    }

    const db = getDB(context);

    const correction = await db
      .prepare(
        'SELECT c.building_id, c.contact_email, c.status, b.address AS building_address, b.slug AS building_slug ' +
          'FROM record_corrections c JOIN buildings b ON b.id = c.building_id WHERE c.id = ?',
      )
      .bind(correctionId)
      .first<CorrectionRow>();

    if (!correction) {
      return json({ error: 'Correction not found' }, 404);
    }
    if (correction.status === 'resolved') {
      return json({ error: 'Correction has already been resolved' }, 409);
    }

    // The gate: no resolution without evidence. Ordered newest-first so the audit
    // row points at the pull the admin actually looked at.
    const pull = await db
      .prepare('SELECT id FROM record_pulls WHERE correction_id = ? ORDER BY retrieved_at DESC, rowid DESC LIMIT 1')
      .bind(correctionId)
      .first<{ id: string }>();

    if (!pull) {
      return json({ error: 'Re-pull from the source before resolving' }, 409);
    }

    await db
      .prepare(
        "UPDATE record_corrections SET status = 'resolved', resolution = ?, resolution_notes = ?, " +
          'resolved_by = ?, resolved_at = unixepoch() WHERE id = ?',
      )
      .bind(resolution, notes || null, user.id, correctionId)
      .run();

    await createAuditLog(db, {
      adminUserId: user.id,
      adminIp: getClientIP(context),
      actionType: 'record_correction_resolved',
      entityType: 'building',
      entityId: correction.building_id,
      oldValue: { status: 'pending' },
      newValue: { status: 'resolved', resolution, pullId: pull.id },
      notes: notes ? `correction ${correctionId}: ${notes}` : `correction ${correctionId}`,
    });

    // Only the filers who left an address hear back — the report is anonymous
    // otherwise, and that is the point.
    if (correction.contact_email) {
      const env = getEnv(context);
      const apiKey = env.RESEND_API_KEY;
      if (apiKey) {
        const siteUrl = env.SITE_URL || context.url.origin;
        fireAndForget(
          context,
          sendRecordCorrectionOutcomeEmail(
            apiKey,
            correction.contact_email,
            correction.building_address,
            `${siteUrl}/building/${correction.building_slug}#public-records`,
            resolution,
          ),
        );
      } else {
        console.warn('RESEND_API_KEY not configured - skipping record correction outcome email');
      }
    }

    return json({ data: { id: correctionId, status: 'resolved', resolution } }, 200);
  } catch (error) {
    logError('record_correction_resolve_failed', {
      endpoint: 'admin/records/corrections/resolve',
      correctionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: 'Failed to resolve correction' }, 500);
  }
};
