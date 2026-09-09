/**
 * API Response Types
 *
 * Centralized type definitions for API responses.
 * Import these in components that consume APIs for type safety.
 */

// Type-only, so nothing from lib/records/ reaches a browser bundle through this file.
import type { QueueReason } from './records/types';

// =============================================================================
// Common Types
// =============================================================================

export interface ApiError {
  error: string;
  details?: Record<string, string>;
}

export interface ApiSuccess<T> {
  data?: T;
  success?: boolean;
}

// =============================================================================
// Auth Responses
// =============================================================================

export interface SignInResponse {
  success: boolean;
  redirect?: string;
}

export interface SignUpResponse {
  success: boolean;
  redirect?: string;
}

export interface ResendVerificationResponse {
  success: boolean;
  message?: string;
}

// =============================================================================
// Review Types
// =============================================================================

export interface UserReview {
  id: string;
  building_id: string;
  building_address: string;
  building_slug: string;
  neighborhood: string | null;
  city: string;
  overall_score: number;
  status: 'pending' | 'approved' | 'rejected';
  is_verified: boolean;
  created_at: number;
  updated_at: number | null;
  review_title: string | null;
  moderation_notes: string | null;
  has_open_dispute: boolean;
}

export interface UserReviewsResponse {
  reviews: UserReview[];
}

export interface AdminReview {
  id: string;
  user_id: string;
  user_email: string;
  building_id: string;
  building_address: string;
  building_city: string;
  review_title: string | null;
  review_text: string | null;
  overall_score: number;
  status: 'pending' | 'approved' | 'rejected';
  is_verified: boolean;
  created_at: number;
  move_in_year: number;
  move_in_season: string;
  unit_type: string;
  rent_amount: number | null;
}

export interface AdminReviewsResponse {
  reviews: AdminReview[];
}

export interface ReviewCreateResponse {
  success: boolean;
  reviewId: string;
  buildingSlug: string;
}

// =============================================================================
// Building Types
// =============================================================================

export interface BuildingSearchResult {
  id: string;
  address: string;
  slug: string;
  neighborhood: string | null;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
}

export interface BuildingSearchResponse {
  buildings: BuildingSearchResult[];
  created?: boolean;
  building?: BuildingSearchResult;
}

export interface MapBuilding {
  id: string;
  slug: string;
  address: string;
  neighborhood: string | null;
  latitude: number;
  longitude: number;
  review_count: number;
  avg_overall: number | null;
}

export interface BuildingsMapResponse {
  buildings: MapBuilding[];
}

export interface AdminBuilding {
  id: string;
  address: string;
  slug: string;
  neighborhood: string | null;
  city: string;
  state: string;
  zip_code: string | null;
  landlord_id: string | null;
  landlord_name: string | null;
  property_manager_id: string | null;
  manager_name: string | null;
  review_count: number;
  created_at: number;
}

export interface AdminBuildingsResponse {
  buildings: AdminBuilding[];
}

// =============================================================================
// Landlord Types
// =============================================================================

export interface AdminLandlord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  building_count: number;
  review_count: number;
  created_at: number;
}

export interface AdminLandlordsResponse {
  landlords: AdminLandlord[];
}

// =============================================================================
// Property Manager Types
// =============================================================================

export interface AdminManager {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  building_count: number;
  created_at: number;
}

export interface AdminManagersResponse {
  managers: AdminManager[];
}

// =============================================================================
// User Types
// =============================================================================

export interface AdminUser {
  id: string;
  email: string;
  is_admin: boolean;
  email_verified: boolean;
  review_count: number;
  created_at: number;
}

export interface AdminUsersResponse {
  users: AdminUser[];
}

// =============================================================================
// Dispute Types
// =============================================================================

export type DisputeOutcome = 'uphold' | 'dismiss' | 'partially_valid';

export interface Dispute {
  id: string;
  review_id: string;
  landlord_name: string;
  landlord_email: string;
  landlord_phone: string;
  dispute_reasons: string; // JSON array
  dispute_explanation: string | null;
  status: 'pending' | 'resolved';
  resolution_outcome: DisputeOutcome | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
  // Joined fields (from GET /api/disputes)
  building_address: string;
  review_text: string | null;
  review_title: string | null;
  review_overall_score: number | null;
}

export interface DisputesResponse {
  disputes: Dispute[];
}

export interface DisputeSubmitResponse {
  success: boolean;
  disputeId: string;
}

// =============================================================================
// Verification Types
// =============================================================================

export interface PendingVerification {
  id: string;
  user_id: string;
  user_email: string;
  review_id: string;
  building_address: string;
  document_type: string;
  document_url: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: number;
}

export interface PendingVerificationsResponse {
  verifications: PendingVerification[];
}

export interface VerificationUploadResponse {
  success: boolean;
  verificationId: string;
}

// =============================================================================
// Audit Log Types
// =============================================================================

export type AuditActionType =
  | 'review_approved'
  | 'review_rejected'
  | 'review_deleted'
  | 'dispute_upheld'
  | 'dispute_dismissed'
  | 'dispute_partially_valid'
  | 'landlord_deleted'
  | 'user_updated'
  | 'records_pulled'
  | 'record_correction_resolved';

export interface AuditLogEntry {
  id: number;
  created_at: number;
  admin_user_id: string;
  admin_email: string | null;
  admin_ip: string;
  action_type: AuditActionType;
  entity_type: 'review' | 'dispute' | 'landlord' | 'user';
  entity_id: string;
  old_value: string | null; // JSON
  new_value: string | null; // JSON
  notes: string | null;
}

export interface AuditFilterOption {
  id: string;
  email: string;
}

export interface AuditLogsResponse {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  pages: number;
  filters: {
    actionTypes: AuditActionType[];
    adminUsers: AuditFilterOption[];
  };
}

// =============================================================================
// Saved Buildings Types
// =============================================================================

export interface SavedBuilding {
  id: number;
  building_id: string;
  building_address: string;
  building_slug: string;
  neighborhood: string | null;
  city: string;
  state: string;
  review_count: number;
  avg_overall: number | null;
  saved_at: number;
}

export interface SavedBuildingsResponse {
  buildings: SavedBuilding[];
}

// =============================================================================
// Cleanup Types
// =============================================================================

export interface CleanupPreviewResponse {
  orphanedBuildings: Array<{
    id: string;
    address: string;
    created_at: number;
  }>;
  count: number;
}

export interface CleanupResponse {
  success: boolean;
  deleted: number;
}

// =============================================================================
// Public Records Types
// =============================================================================

/**
 * One row of GET /api/admin/records/corrections — a `record_corrections` row
 * joined to its building. `record_kind` is null when the report was filed
 * against the whole records panel rather than one record (see
 * `fromStoredKind` in lib/records/corrections.ts).
 */
export interface RecordCorrection {
  id: string;
  building_id: string;
  record_kind: string | null;
  claim: string;
  /** 1 when the filer left an address, so the queue can say whether resolving emails them. The address itself is never sent to the client. */
  has_contact_email: number;
  /** 1 when a re-pull already succeeded (`ok`/`empty`) for this correction, so a reload can re-enable Resolve without a fresh client-side re-pull. */
  has_pull: number;
  status: 'pending' | 'resolved';
  resolution: 'repulled_unchanged' | 'repulled_updated' | 'source_mismatch_noted' | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: number | null;
  created_at: number;
  building_address: string;
  building_slug: string;
}

/**
 * GET /api/admin/records/queue — the pull queue at a glance. Mirrors `QueueStats`
 * in lib/records/queue.ts, which is the server-side source of truth; this copy
 * exists so the admin panel does not import the queue module (and its SQL) into
 * the browser bundle.
 *
 * `pendingByReason` counts claimable rows only — a row that has exhausted its
 * attempts is counted once, under `parked`.
 */
export interface RecordsQueueStats {
  pendingByReason: Record<'button' | 'follower' | 'refresh' | 'fill', number>;
  parked: number;
  oldestPendingAgeSeconds: number | null;
  completedLast24h: number;
  fillPaused: boolean;
}

/**
 * One parked `records_queue` row joined to its building: a pull that failed its
 * way out of the queue and is waiting for an admin to press Retry.
 *
 * `locked_at` is here because "parked" and "still running" overlap: `attempts`
 * counts CLAIMS, so a row hits MAX_ATTEMPTS at the moment of its last claim and
 * looks parked while its pull is still in flight for up to LOCK_TTL_SECONDS. The
 * panel compares this against the clock to decide whether Retry is safe to offer.
 */
export interface RecordsQueueParkedRow {
  id: number;
  reason: QueueReason;
  attempts: number;
  last_error: string | null;
  requested_at: number;
  /** Unix seconds of the lease held by the claim that is (or was) pulling this row. */
  locked_at: number | null;
  address: string;
  slug: string;
}

/**
 * What the daily scheduler stamps into `app_settings.records_fixture_last` — the
 * last circuit-breaker fixture run against the Lanark address. Written by `plan`
 * in lib/records/scheduler.ts and read back by GET /api/admin/records/queue; the
 * shape lives here so the writer and the panel cannot drift apart.
 *
 * A stored row that does not match is reported as `null` rather than thrown at the
 * panel: a settings row from a newer scheduler must not take the counts down with it.
 */
export interface RecordsQueueFixtureResult {
  /** Unix seconds of the plan run that wrote this. */
  at: number;
  /** `checksFailed` plus `sourceErrors.length` — the one number that decides pass/fail. */
  failures: number;
  /** Checks that came back not-ok, counted separately from the sources that threw. */
  checksFailed: number;
  /** Labels of the checks that came back not-ok. */
  failed: string[];
  /** Sources whose run() threw, by label. */
  sourceErrors: Array<{ label: string; message: string }>;
  /** Row count per source label, for the sources that ran. One that threw is absent, not zero. */
  rowsBySource: Record<string, number>;
}
