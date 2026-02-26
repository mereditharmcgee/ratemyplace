# Requirements: RateMyPlace Launch Prep

**Defined:** 2026-02-26
**Core Value:** Tenants can submit honest, anonymous reviews and see aggregated scores for buildings and landlords

## v1 Requirements

### Email Verification

- [ ] **EMAIL-01**: User receives verification email after signup with secure token link (infrastructure ready)
- [ ] **EMAIL-02**: User can click verification link to mark email as verified (infrastructure ready)
- [x] **EMAIL-03**: Verified users display "Verified" badge on their reviews
- [x] **EMAIL-04**: Unverified users can still submit reviews (no blocking)
- [ ] **EMAIL-05**: User can request new verification email if original expired (infrastructure ready)

### Landlord Disputes

- [ ] **DISP-01**: Landlord can submit dispute form with building selection and explanation
- [ ] **DISP-02**: Dispute form requires landlord contact information
- [ ] **DISP-03**: Disputes appear in admin queue for review
- [ ] **DISP-04**: Admin can view disputed review alongside dispute submission
- [ ] **DISP-05**: Admin can mark dispute as resolved/dismissed with notes

### Security Hardening

- [ ] **SEC-01**: Rate limiting fails closed (blocks requests on DB error, not allows)
- [ ] **SEC-02**: Rate limit failures logged with alerts
- [ ] **SEC-03**: Admin actions logged with audit trail (who, what, when)

## v2 Requirements

### Deferred Features

- **NOTIF-01**: Email notifications for dispute status changes
- **NOTIF-02**: Email notifications for review approval
- **PROF-01**: User profile pages showing their reviews

## Out of Scope

| Feature | Reason |
|---------|--------|
| Landlord direct rebuttals | Explicitly excluded from MVP — privacy concern |
| Multi-language support | Deferred to v2.0 |
| Delayed posting | Not required for launch |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EMAIL-01 | Phase 1 | In Progress (infrastructure ready) |
| EMAIL-02 | Phase 1 | In Progress (infrastructure ready) |
| EMAIL-03 | Phase 1 | Complete |
| EMAIL-04 | Phase 1 | Complete |
| EMAIL-05 | Phase 1 | In Progress (infrastructure ready) |
| DISP-01 | Phase 2 | Pending |
| DISP-02 | Phase 2 | Pending |
| DISP-03 | Phase 2 | Pending |
| DISP-04 | Phase 2 | Pending |
| DISP-05 | Phase 2 | Pending |
| SEC-01 | Phase 3 | Pending |
| SEC-02 | Phase 3 | Pending |
| SEC-03 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-26*
