/**
 * API Response Types
 *
 * Centralized type definitions for API responses.
 * Import these in components that consume APIs for type safety.
 */

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
  | 'user_updated';

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
