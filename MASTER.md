# RateMyPlace Boston — Master Project Document

*Version 1.1 | May 2026*

---

## Table of contents

1. [Mission and problem statement](#1-mission-and-problem-statement)
2. [Evidence base](#2-evidence-base)
3. [Ethical framework](#3-ethical-framework)
4. [Rating instrument](#4-rating-instrument)
5. [Privacy and safety](#5-privacy-and-safety)
6. [Verification system](#6-verification-system)
7. [Moderation and disputes](#7-moderation-and-disputes)
8. [Technical architecture](#8-technical-architecture)
9. [Legal and policy](#9-legal-and-policy)
10. [Development phases](#10-development-phases)

---

## 1. Mission and problem statement

### What we're building

RateMyPlace Boston is a tenant-powered housing review platform that allows renters to rate their apartment unit, building, and landlord using a structured, evidence-based assessment. Think RateMyProfessor, but for housing.

### The problem

**Housing is a social determinant of health.** Substandard housing conditions cause respiratory disease, cardiovascular problems, mental health issues, and injuries. The people most affected are low-income renters and communities of color who face compounding disadvantages.

**Rental markets have extreme information asymmetry.** Landlords run credit checks and use tenant blacklists. Tenants have almost no way to research a landlord's track record before signing a lease. This power imbalance lets problem landlords operate without accountability.

### Theory of change

**If** tenants can access structured, comparable information about units, buildings, and landlords,
**Then** they can make more informed housing decisions,
**Which** reduces exposure to substandard housing,
**Leading to** improved health outcomes and landlord accountability.

### What success looks like

- Prospective tenants can research a building before signing a lease
- Patterns of neglect across a landlord's portfolio become visible
- Tenant organizing is supported by shared information
- Advocacy organizations have data to support policy interventions

---

## 2. Evidence base

### Housing and health literature

**Physical health pathways:**
- Substandard conditions (leaks, pests, poor ventilation) are associated with asthma and respiratory disease (CDC/NCHH, 2007)
- Each additional housing deficiency independently predicts poorer health status and higher hospitalization risk (Jacobs et al., 2009)
- Indoor hazards including mold, lead, and inadequate temperature control contribute to cardiovascular and respiratory illness (WHO Housing and Health Guidelines, 2018)

**Mental health pathways:**
- Housing instability and poor quality are associated with depression, anxiety, and psychological distress (Healthy People 2030)
- Fear of landlord retaliation contributes to chronic stress (Desmond, 2016)

**Health equity:**
- Black and Hispanic/Latino households disproportionately live in substandard housing (Habitat for Humanity, 2024)
- Housing disparities are patterned along race, income, and immigration status, amplifying existing health inequities

### Information asymmetry literature

- Rental markets are characterized by extreme information asymmetry favoring landlords (Stiglitz, 2002)
- Making property ownership information accessible helps tenants organize and enables better market regulation (St-Hilaire et al., 2022)

### Frameworks informing our design

- **HUD/CDC Healthy Homes principles**: Dry, clean, safe, ventilated, pest-free, contaminant-free, maintained, thermally controlled
- **WHO Housing and Health Guidelines**: Evidence-based recommendations on indoor conditions
- **HUD Housing Quality Standards**: Minimum habitability criteria
- **Healthy People 2030**: National objectives for housing as environmental health

---

## 3. Ethical framework

### Core principles

1. **Tenant safety first**: Design decisions must never increase retaliation risk. Anonymity is a safety feature, not optional.

2. **Equity-centered**: The platform must serve those who bear the greatest housing burdens.

3. **Data as power**: Information collected serves tenant interests. We do not share data in ways that could harm tenants.

4. **Do no harm**: The platform must not become a tool for discrimination or harassment.

5. **Honesty about limitations**: We cannot solve housing affordability, supply, or discrimination. We don't overpromise.

**Implementation status key:**
- **Built today** — Implemented in the current application source.
- **Planned** — An intended product commitment that is not yet implemented and should not be read as a current capability or protection.

### Specific commitments

**To tenants:**
- Your identity is protected through anonymization
- We clearly communicate risks and best practices
- We never share your information with landlords
- You can delete your account and data

**To landlords:**
- Reviews go through moderation
- You can dispute reviews through a defined process
- We distinguish verified from unverified reviews
- We don't remove reviews simply because you disagree

**To the public:**
- We're transparent about our methodology
- We don't sell data
- We document our limitations

---

## 4. Rating instrument

### Design principles

The rating instrument is grounded in three validated housing assessment instruments from peer-reviewed public health research:

- **Observational Housing Quality Scale (OHQS)** — Krieger and Higgins (2002). Source for unit-level structural and condition items.
- **Physical Housing Quality Scale (PHQS)** — Jacobs et al. (2009). Source for building-level items including common areas, security, and noise.
- **WHO LARES Study** — Bonnefoy et al. (2003). Source for landlord/management items including communication, professionalism, and non-retaliation.

Supporting frameworks include the HUD Housing Quality Standards (24 CFR 982), CDC Healthy Homes principles, and Healthy People 2030 housing objectives. These frameworks shape which dimensions matter; the three instruments above provide the validated item wording.

Design rules:
- **Standardized scales**: All scored items use a 5-point Likert (Strongly Disagree → Strongly Agree)
- **Behavioral anchoring**: Items describe observable conditions, not opinions
- **Health-relevant dimensions**: Every item maps to a documented health pathway
- **Domain-separated scoring**: Scores are reported separately for unit, building, and landlord rather than as a single number

The total instrument is **27 scored items** (Unit 10 + Building 9 + Landlord 8) plus 5 ancillary supplementary items that capture context but are not fed into the score. Canonical source: `src/lib/surveyItems.ts`.

### Unit rating (10 items, all required)

| Code | Dimension | Survey item |
|------|-----------|-------------|
| U1 | Structural Integrity | "Walls, floors, and ceilings were in good condition, without holes, cracks, peeling paint, or water damage." |
| U2 | Plumbing | "Plumbing worked reliably, with adequate water pressure, no leaks, and consistent hot water." |
| U3 | Electrical Systems | "Electrical systems worked safely, with enough outlets, no flickering lights, and all fixtures functional." |
| U4 | Temperature Control | "I could maintain a comfortable temperature year-round, with adequate heat in winter and cooling or ventilation in summer." |
| U5 | Ventilation & Air Quality | "The unit had adequate airflow and ventilation, without persistent stuffiness, odors, or moisture buildup." |
| U6 | Pest Control | "The unit was free from pest problems, including roaches, mice, rats, and bedbugs." |
| U7 | Mold & Moisture | "The unit was free from mold, mildew, or persistent moisture problems." |
| U8 | Appliances | "Appliances included with the unit worked reliably throughout my tenancy." |
| U9 | Layout & Functionality | "The unit's layout and space were functional for daily living." |
| U10 | Listing Accuracy | "The unit matched what was advertised or shown during viewing." |

### Building rating (9 items, two allow N/A)

| Code | Dimension | Survey item | N/A |
|------|-----------|-------------|-----|
| B1 | Common Areas | "Hallways, stairs, lobby, and other shared spaces were kept clean and in good repair." | No |
| B2 | Building Security | "The building felt secure, with working locks, adequate lighting, and functional entry systems." | No |
| B3 | Exterior & Grounds | "The building exterior and grounds were well-maintained, including snow removal, landscaping, and trash areas." | No |
| B4 | Noise — Internal | "Noise from adjacent units or building systems was at a reasonable level." | No |
| B5 | Noise — External | "Noise from outside the building, such as traffic, construction, or street activity, was at a reasonable level." | No |
| B6 | Mail & Package Security | "Mail delivery was secure, and packages were protected from theft or weather damage." | No |
| B7 | Laundry Facilities | "Laundry facilities, if provided, were functional and reasonably maintained." | Yes |
| B8 | Parking | "Parking, if included, matched what was promised and was adequately maintained." | Yes |
| B9 | Trash & Recycling | "Trash and recycling facilities were adequate and serviced regularly." | No |

### Landlord rating (8 items, two allow N/A)

| Code | Dimension | Survey item | N/A |
|------|-----------|-------------|-----|
| L1 | Maintenance Response | "Maintenance requests were addressed in a timely manner." | No |
| L2 | Communication | "The landlord or management was easy to reach and responded to communications promptly." | No |
| L3 | Professionalism | "Interactions with the landlord or management were respectful and professional." | No |
| L4 | Lease Clarity | "Lease terms were clear, and the landlord honored all agreements." | No |
| L5 | Privacy & Boundaries | "The landlord respected my privacy and provided appropriate notice before entering the unit." | No |
| L6 | Security Deposit | "The security deposit was handled fairly, with clear accounting and timely return if applicable." | Yes |
| L7 | Rent Practices | "Rent increases, if any, were reasonable and communicated with appropriate notice." | Yes |
| L8 | Non-Retaliation | "I felt comfortable raising concerns or requesting repairs without fear of retaliation." | No |

### Supplementary items (5 ancillary, not scored)

These capture context but do not feed the rating score:

- **Would recommend**: "Would you recommend this unit to a friend or family member?" (Yes / No / Maybe)
- **Tenure**: "How long did you live at this address?" (months)
- **Move-out timing**: "When did you move out?" (or "I still live here")
- **Housing vouchers**: "To your knowledge, does this property accept Housing Choice Vouchers (Section 8)?"
- **Night safety**: "Was the building and surrounding area safely lit at night?"

Plus an optional free-text comments field (500-character limit).

### Scoring logic

**Three domain scores plus an overall:**

1. **Unit score** — weighted average of all 10 unit items
2. **Building score** — weighted average of answered building items (treats N/A as not contributing)
3. **Landlord score** — weighted average of answered landlord items
4. **Overall score** — weighted blend of the three domain scores

**Domain weighting** (per `src/lib/scoring.ts` — see also the methodology page):
- Items drawn from OHQS-validated dimensions are weighted **1.5×**
- Items drawn from PHQS-validated dimensions are weighted **1.3×**
- Items drawn from WHO LARES-validated dimensions are weighted **1.2×**
- Items not drawn from a validated source carry weight **1.0×**

The weighting reflects how strongly each instrument's items have been associated with health and housing outcomes in the underlying research, not editorial preference.

**Minimum thresholds for display:**
- Building scores: shown with 1+ approved review
- Named-party aggregates (landlords and property managers): shown only with 3+ approved reviews across the named party's portfolio

Items where the reviewer chose "Not rated" do not contribute to any average and are surfaced on review cards as a muted "Not rated" row so readers can distinguish a skipped item from a low score.

For the full methodology including weighting tables, item-level rationale, and academic citations, see the live methodology page (`src/pages/methodology.astro`) and `src/lib/scoring.ts`.

---

## 5. Privacy and safety

### Philosophy

We collect precise data for analysis and moderation but display fuzzy data to protect reviewer identity.

### Data collection vs. display

| Data point | Collected | Displayed | Rationale |
|------------|-----------|-----------|-----------|
| Submission date | Exact timestamp | Never shown | Prevents identification |
| Move-out timing | Exact (optional) | Fuzzy bucket only | "Within last 2 years" etc. |
| Tenure | Exact months | Fuzzy bucket only | "1-3 years" etc. |
| Unit number | Collected (admin-only, deprecated) | Never shown publicly | See deprecation note below |
| IP address | Never stored | N/A | Privacy protection |
| Reviewer account | Linked in DB | Never shown | Enables edit/delete |

**Deprecation note — `reviews.unit_number`:** The `unit_number` column was added in migration `0004_survey_scores.sql` to support per-unit grouping of reviews on building pages. As of commit `e003645` it is no longer displayed on any public surface — building pages group reviews by bedroom count only. The column is retained for admin moderation visibility and will be dropped in a follow-up migration scheduled for ~May 14, 2026. New review submissions still write `unit_number` so admins can investigate questionable reviews; this stops at the column-drop migration.

### User communication

**Before account creation**, users see:
- What we collect and don't collect
- How their review will appear (anonymized example)
- Clear statement that we don't share information with landlords

**Before review submission**, users see:
- Warning about identifiable details in comments
- Checklist of things to avoid (names, unit numbers, specific dates)
- Checkbox: "I understand my landlord may be able to identify me based on details in my review"

### Technical protections

- No IP address logging
- Fuzzy date display via `formatRecency` helper (season + year only)
- Rate limiting to prevent enumeration attacks
- No analytics that track individual users

---

## 6. Verification system

### Tiers

| Tier | Badge | Requirements |
|------|-------|--------------|
| Standard | None | Email verification |
| Verified | ✓ | Proof of address uploaded and approved |

Reviews without verification simply lack the badge — they are not labeled "Unverified."

### Accepted documents

Must show address matching the reviewed building:
- Utility bill (electric, gas, water, internet)
- Bank statement
- Government mail
- Lease agreement (sensitive terms may be redacted)

**Not accepted:** ID cards (we verify residence, not identity)

### Verification workflow

1. User uploads document to secure temporary storage
2. Moderator reviews: Does address match building?
3. Decision: Approved or Rejected (with reason)
4. Document **immediately deleted** regardless of decision
5. User notified of outcome

### Security

- Documents stored in encrypted temporary bucket
- Only designated moderators can view
- Automatic deletion after decision
- Audit log of who viewed what

---

## 7. Moderation and disputes

### Content standards

**Remove if review contains:**
- Direct threats
- Hate speech or slurs
- Doxxing (posting private information)
- Spam or advertising
- Admission of not living at the property

**Built today — current path for content that needs changes:**
- Moderators can reject a review.
- The reviewer can edit and resubmit a rejected review, which returns it to the pending moderation queue.

**Planned — limited moderator editing with user notification if review contains:**
- Accidental PII (phone numbers, emails, names)
- Information that could identify the reviewer

**Keep even if:**
- Very negative (opinions are protected)
- Landlord disputes claims
- Describes illegal landlord behavior
- Poor writing quality

### Moderation queue triggers

**Built today:**
- Every submitted or edited review enters the pending moderation queue before publication.
- Moderators can manually approve, reject, flag, or return a review to pending.
- Landlord disputes enter a private admin review process.

**Planned — automatic prioritization signals:**
- PII patterns detected
- Profanity or slurs
- User has previous removed content
- Multiple reviews for same building quickly

These signals will prioritize human review; they will not make publication or removal decisions automatically.

**Planned — additional manual intake:**
- User reports

### Landlord dispute process

**Landlords cannot respond publicly.** They can submit a dispute form.

**Built today — dispute form collects:**
- Contact information
- Which review and why
- An optional written explanation

**Planned:**
- Supporting documentation uploads (optional)

**Dispute review process:**
1. Received within 5 business days
2. Compare claims to review content
3. Decision: No action / Flag for detailed review / Remove specific content
4. Notify landlord of outcome (general terms only)

**Key principle:** Negative reviews are not removed because a landlord disagrees. Only policy violations warrant removal.

### User notifications

**Built today:** Review approval or rejection attempts to create an in-app notification. When email delivery is configured, rejection also queues an email with any supplied moderator reason and a link to the edit-and-resubmit flow.

**Planned:** When a moderator edits or redacts content, the user will receive an email explaining what changed, why, and how to appeal or resubmit.

---

## 8. Technical architecture

### Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Framework | Astro 5.x (SSR + React islands) | Fast, SEO-friendly, islands architecture |
| Hosting | Cloudflare Pages | Free tier, global CDN, GitHub integration |
| Database | Cloudflare D1 (SQLite) | Serverless, generous free tier, edge-native |
| Auth | Lucia v3 + D1 adapter, Google OAuth | Lightweight, works with D1 |
| Styling | Tailwind CSS 4.x | Utility-first, brand color tokens |
| Language | TypeScript (strict) | Type safety |
| Object storage | Cloudflare R2 | Verification document temporary storage |

### Database schema (current production)

The schema below reflects all migrations through `0024_perf_indexes.sql`. Migrations are applied sequentially via `npx wrangler d1 migrations apply ratemyplace-db`. Numbers `0021` and `0022` are reserved no-ops to preserve sequence numbering.

```sql
-- Landlords (migration 0001 + 0009 admin/owner fields)
CREATE TABLE landlords (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  admin_notes TEXT,
  owner_entity TEXT,
  total_units INTEGER,
  verified INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Buildings (migration 0001 + 0006 property_manager_id + 0009 admin/public_info)
CREATE TABLE buildings (
  id TEXT PRIMARY KEY,
  landlord_id TEXT REFERENCES landlords(id),
  property_manager_id TEXT REFERENCES property_managers(id),
  address TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  neighborhood TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  latitude REAL,
  longitude REAL,
  year_built INTEGER,
  unit_count INTEGER,
  building_type TEXT,
  admin_notes TEXT,
  public_info TEXT,        -- JSON
  owner_name TEXT,
  owner_entity TEXT,
  owner_website TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Property managers (migration 0006 + 0009 admin fields)
CREATE TABLE property_managers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  company_name TEXT,
  description TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  admin_notes TEXT,
  total_units INTEGER,
  verified INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Users (migration 0001 + 0003 OAuth + 0016 nullable password)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  hashed_password TEXT,    -- nullable for OAuth-only accounts
  google_id TEXT,
  name TEXT,
  avatar_url TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Reviews (migration 0001 + 0004 survey scores + 0007 verification + 0008 laundry/utilities + 0017 PM name + 0019 voucher/safety)
CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,

  -- Tenancy (fuzzy display, exact storage)
  move_in_year INTEGER NOT NULL,
  move_in_season TEXT NOT NULL CHECK (move_in_season IN ('winter','spring','summer','fall')),
  move_out_year INTEGER,
  move_out_season TEXT,
  move_out_year_new TEXT,
  is_current_tenant INTEGER NOT NULL DEFAULT 0,
  tenure_months INTEGER,

  -- Unit metadata
  unit_type TEXT NOT NULL CHECK (unit_type IN ('studio','1br','2br','3br','4br+','house')),
  unit_number TEXT,        -- DEPRECATED: collected admin-only, never displayed (commit e003645). Scheduled for column drop ~May 14, 2026.
  bedrooms TEXT,
  bathrooms TEXT,
  square_footage INTEGER,
  rent_amount INTEGER,
  amenities TEXT,          -- JSON
  utilities_included TEXT, -- JSON
  estimated_monthly_utilities INTEGER,

  -- Laundry / parking / pets / pests
  laundry_type TEXT,
  laundry_cost_per_load REAL,
  laundry_wash_cost TEXT,  -- legacy
  laundry_dry_cost TEXT,   -- legacy
  parking_type TEXT,
  pet_types TEXT,          -- JSON
  had_pests INTEGER DEFAULT 0,
  pest_types_experienced TEXT,

  -- 27 SCORED RATING ITEMS (1–5 Likert, all from src/lib/surveyItems.ts)
  -- Unit (10)
  unit_structural INTEGER CHECK (unit_structural BETWEEN 1 AND 5),
  unit_plumbing INTEGER CHECK (unit_plumbing BETWEEN 1 AND 5),
  unit_electrical INTEGER CHECK (unit_electrical BETWEEN 1 AND 5),
  unit_climate INTEGER CHECK (unit_climate BETWEEN 1 AND 5),
  unit_ventilation INTEGER CHECK (unit_ventilation BETWEEN 1 AND 5),
  unit_pests INTEGER CHECK (unit_pests BETWEEN 1 AND 5),
  unit_mold INTEGER CHECK (unit_mold BETWEEN 1 AND 5),
  unit_appliances INTEGER CHECK (unit_appliances BETWEEN 1 AND 5),
  unit_layout INTEGER CHECK (unit_layout BETWEEN 1 AND 5),
  unit_accuracy INTEGER CHECK (unit_accuracy BETWEEN 1 AND 5),
  -- Building (9)
  building_common_areas INTEGER CHECK (building_common_areas BETWEEN 1 AND 5),
  building_security INTEGER CHECK (building_security BETWEEN 1 AND 5),
  building_exterior INTEGER CHECK (building_exterior BETWEEN 1 AND 5),
  building_noise_neighbors INTEGER CHECK (building_noise_neighbors BETWEEN 1 AND 5),
  building_noise_external INTEGER CHECK (building_noise_external BETWEEN 1 AND 5),
  building_mail INTEGER CHECK (building_mail BETWEEN 1 AND 5),
  building_laundry INTEGER CHECK (building_laundry BETWEEN 1 AND 5),
  building_parking INTEGER CHECK (building_parking BETWEEN 1 AND 5),
  building_trash INTEGER CHECK (building_trash BETWEEN 1 AND 5),
  -- Landlord (8)
  landlord_maintenance INTEGER CHECK (landlord_maintenance BETWEEN 1 AND 5),
  landlord_communication INTEGER CHECK (landlord_communication BETWEEN 1 AND 5),
  landlord_professionalism INTEGER CHECK (landlord_professionalism BETWEEN 1 AND 5),
  landlord_lease_clarity INTEGER CHECK (landlord_lease_clarity BETWEEN 1 AND 5),
  landlord_privacy INTEGER CHECK (landlord_privacy BETWEEN 1 AND 5),
  landlord_deposit INTEGER CHECK (landlord_deposit BETWEEN 1 AND 5),
  landlord_rent_practices INTEGER CHECK (landlord_rent_practices BETWEEN 1 AND 5),
  landlord_non_retaliation INTEGER CHECK (landlord_non_retaliation BETWEEN 1 AND 5),

  -- Legacy v1 score columns (kept for backward-compat with pre-0004 reviews; new reviews don't write these)
  score_building_quality INTEGER CHECK (score_building_quality BETWEEN 1 AND 5),
  score_maintenance INTEGER CHECK (score_maintenance BETWEEN 1 AND 5),
  -- ... 10 more legacy score_* columns omitted for brevity, see migrations/0001_initial.sql

  -- Computed
  overall_score REAL,

  -- Written content + landlord/PM names
  review_title TEXT,
  review_text TEXT,
  comments TEXT,
  landlord_name TEXT,
  property_manager_name TEXT,
  has_onsite_manager INTEGER DEFAULT 0,

  -- Supplementary (ancillary, not scored)
  would_recommend INTEGER NOT NULL DEFAULT 1,  -- legacy boolean
  would_recommend_new TEXT,                    -- 'yes'|'no'|'maybe'
  accepts_housing_vouchers TEXT,
  safely_lit_at_night TEXT,

  -- Issue flags
  had_pest_issues INTEGER NOT NULL DEFAULT 0,
  had_heat_issues INTEGER NOT NULL DEFAULT 0,
  had_water_issues INTEGER NOT NULL DEFAULT 0,
  had_security_deposit_issues INTEGER NOT NULL DEFAULT 0,
  had_eviction_threat INTEGER NOT NULL DEFAULT 0,

  -- Verification + moderation
  is_verified INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER,
  verified_by TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','flagged')),
  moderated_at TEXT,
  moderated_by TEXT,
  moderation_notes TEXT,
  rejection_reason TEXT,

  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Aggregated score caches (recomputed by API on review approval)
CREATE TABLE building_scores (...);          -- per-building averages, see migration 0001
CREATE TABLE landlord_scores (...);          -- per-landlord averages, see migration 0001
CREATE TABLE property_manager_scores (...);  -- per-PM averages, see migration 0006

-- Verification documents (temporary storage; deleted after moderator decision)
CREATE TABLE verification_images (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  uploaded_at INTEGER NOT NULL DEFAULT (unixepoch()),
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES users(id),
  rejection_reason TEXT
);

-- Auth + tokens
CREATE TABLE verification_tokens (...);    -- email verify, migration 0011
CREATE TABLE password_reset_tokens (...);  -- 1-hour single-use, migration 0015
CREATE TABLE rate_limits (...);            -- generic rate-limit store, migration 0010

-- Disputes (migration 0012) — landlord challenges
CREATE TABLE disputes (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE CASCADE,
  landlord_name TEXT NOT NULL,
  landlord_email TEXT NOT NULL,
  landlord_phone TEXT NOT NULL,
  dispute_reasons TEXT NOT NULL,  -- JSON array
  dispute_explanation TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  resolution_outcome TEXT CHECK (resolution_outcome IN ('uphold','dismiss','partially_valid')),
  resolution_notes TEXT,
  resolved_at INTEGER,
  resolved_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Audit log (migration 0013, expanded 0014) — INSERT-only, immutable
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  admin_user_id TEXT NOT NULL,
  admin_ip TEXT NOT NULL,
  action_type TEXT NOT NULL,    -- review_/dispute_/landlord_/building_ actions
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  notes TEXT
);

-- User-facing tables
CREATE TABLE bug_reports (...);       -- migration 0018
CREATE TABLE contact_messages (...);  -- migration 0020
CREATE TABLE saved_buildings (...);   -- migration 0023, user bookmarks
CREATE TABLE notifications (...);     -- in-app notifications
CREATE TABLE review_votes (...);      -- helpful/not-helpful, migration 0001

-- Performance indexes (migration 0024)
CREATE INDEX idx_reviews_building_status ON reviews(building_id, status);
-- ...plus single-column indexes on slug, status, created_at, etc.
```

### File structure (current)

Snapshot of the meaningful directories. Not exhaustive — see the repo for full file listings.

```
ratemyplace-boston/
├── src/
│   ├── components/
│   │   ├── admin/             # Admin moderation tables (Reviews, Users, Buildings, Disputes, AuditLog, etc.)
│   │   ├── reviews/           # ReviewCard, ReviewForm, ReviewEditForm + multi-step form-steps/
│   │   ├── ratings/           # ScoreCard, StarRating
│   │   ├── search/            # SearchResults, autocomplete
│   │   ├── profile/           # User profile dashboard, bookmarks
│   │   ├── disputes/          # Dispute submission form
│   │   ├── contact/           # Contact form
│   │   ├── layout/            # BaseLayout, Header, Footer
│   │   ├── ui/                # Shared primitives (BookmarkButton, EmptyState, SeasonChip, etc.)
│   │   ├── AddressAutocomplete.tsx
│   │   ├── BuildingMap.tsx    # Google Maps with brand-colored score markers
│   │   └── HomeSearch.tsx
│   ├── pages/
│   │   ├── index.astro                # Homepage hero
│   │   ├── about.astro                # Mission, voice, methodology summary
│   │   ├── methodology.astro          # Public scoring methodology + citations
│   │   ├── search.astro               # Search results
│   │   ├── map.astro                  # Map view
│   │   ├── building/[slug].astro      # Building detail (per-unit-group review breakdown)
│   │   ├── landlord/[slug].astro      # Landlord profile
│   │   ├── property-manager/[slug].astro
│   │   ├── review/                    # New + edit review flows
│   │   ├── profile.astro              # Authenticated user dashboard
│   │   ├── auth/                      # Sign in, sign up, forgot password, OAuth callbacks
│   │   ├── admin/                     # Moderation panel (index, reviews, buildings, landlords, managers, users, verify, disputes, audit, contact, bug-reports)
│   │   ├── api/                       # All server routes (reviews, buildings, search, admin/*, auth/*, disputes, verification, notifications, places, user)
│   │   ├── privacy.astro              # Privacy policy
│   │   ├── terms.astro                # Terms of service
│   │   └── guidelines.astro           # Review guidelines
│   ├── lib/
│   │   ├── scoring.ts                 # Score calculation, weights, domain fields
│   │   ├── scoring-colors.ts          # Canonical score band system (Good/Mixed/Concerning/Poor)
│   │   ├── surveyItems.ts             # The 27 scored items + 5 ancillary items (single source of truth)
│   │   ├── auth.ts                    # Lucia integration
│   │   ├── audit.ts                   # Admin action logging
│   │   ├── disputes.ts
│   │   ├── email.ts                   # Transactional email templates (Resend)
│   │   ├── validation.ts
│   │   ├── privacy.ts                 # Fuzzy date helpers (formatRecency, getSeasonFromMonth)
│   │   ├── rateLimit.ts
│   │   ├── storage.ts                 # R2 upload helpers
│   │   ├── tokens.ts                  # Email verify + password reset tokens
│   │   ├── turnstile.ts               # Cloudflare Turnstile (CAPTCHA) verification
│   │   ├── notifications.ts
│   │   ├── enrichment/                # Boston Assessing API + CT CAMA enrichment
│   │   └── __tests__/                 # Vitest unit tests
│   └── middleware.ts                  # Lucia session check, security headers
├── migrations/                        # 0001–0024, applied via wrangler
├── e2e/                               # Playwright end-to-end tests
├── public/                            # Static assets, OG image generator
├── brand/                             # Logo SVGs, social assets
├── scripts/                           # Seed data, admin utilities
├── .planning/                         # Phase plans, audits, milestone docs (internal)
├── astro.config.mjs
├── wrangler.toml
├── tailwind.config.cjs
├── package.json
├── CLAUDE.md                          # Coding conventions
├── CLAUDE_CONTEXT.md                  # Project context for Claude Code agents
├── ARCHITECTURE.md                    # Technical architecture reference
├── brand.md                           # Brand bible (voice + visual)
├── MASTER.md                          # This document — canonical product spec
└── README.md
```

### Fraud prevention

**Built today:**
- Review submissions are limited to 10 per account per hour.
- Account creation is limited to 3 per IP per hour.
- The server validates Cloudflare Turnstile on signup, sign-in, forgot-password, contact, dispute, bug-report, and review-submission forms.

**Planned — tighter limits and integrity controls:**
- Enforce 1 review per building per account (forever).
- Tighten review submissions to 5 per account per 24 hours.
- Tighten account creation to 3 per IP per 24 hours.

**Planned — velocity alerts that flag for human review:**
- 5+ reviews for same building in 24 hours
- 10+ reviews for same landlord in 24 hours

**Planned — additional bot detection:**
- Honeypot fields where applicable
- Minimum-time submission check

---

## 9. Legal and policy

### Interim terms of service (summary)

- You will only review places where you actually lived
- You will not post false information, threats, or others' private information
- Reviews are your opinion and responsibility
- We may remove content that violates these terms
- Reviews are user opinions, not verified facts
- We are not responsible for decisions based on reviews

### Interim privacy policy (summary)

**What we collect:** Email (for account), reviews, verification documents (temporarily)

**What we don't collect:** Name, IP address, precise location, tracking cookies

**How we use data:** Email for account management, reviews for display, verification docs reviewed then deleted

**Who sees data:** Public sees anonymized reviews; team sees email and verification docs; no one else

**Your rights:** Delete account, download data, edit/remove reviews

### Future legal review

Flag for eventual lawyer review:
- Section 230 protections
- Defamation liability
- Massachusetts consumer protection laws
- CCPA/GDPR applicability

---

## 10. Development phases

### Phase 1: MVP

**Goal:** Working submission and display flow for Boston

- [x] Cloudflare Pages + D1 setup
- [x] Lucia Auth integration
- [x] Review submission form (multi-step)
- [x] Building profile page with scores
- [x] Landlord profile page with scores
- [x] Basic search (address, landlord name)
- [x] Privacy warnings and fuzzy date display
- [x] Home page

### Phase 2: Trust and quality

- [x] Email verification before posting
- [x] Verification document upload and review
- [x] Moderation queue
- [x] Flagging system
- [x] Landlord dispute form

### Phase 3: Community and scale

- [ ] Partner organization feedback incorporated
- [ ] Public records integration (code violations)
- [ ] Data export for advocacy orgs
- [ ] Additional neighborhoods/cities
- [ ] Multi-language support (when budget allows)

---

## References

### Academic literature

- CDC and HUD. (2006). Healthy Housing Reference Manual.
- Desmond, M. (2016). *Evicted: Poverty and Profit in the American City*.
- Jacobs, D.E., et al. (2009). The relationship of housing and population health.
- Krieger, J. and Higgins, D.L. (2002). Housing and health: Time again for public health action.
- St-Hilaire, C., et al. (2022). High Rises and Housing Stress. *JAPA*.
- Taylor, L. (2018). Housing and Health: An Overview of the Literature. *Health Affairs*.
- WHO. (2018). Housing and Health Guidelines.
- Bonnefoy, X., Braubach, M., Moissonnier, B., Monolbaev, K., and Röbbel, N. (2003). WHO LARES Study.

### Standards and frameworks

- HUD Housing Quality Standards (24 CFR 982)
- Healthy People 2030: Quality of Housing
- National Center for Healthy Housing assessment tools

---

## Changelog

- **v1.1 (May 2026)**: Updated 24→27 item instrument count, aligned schema with production (current through migration 0024), documented `unit_number` deprecation in §5 and §8, named OHQS / PHQS / WHO LARES as primary instruments in §4, refreshed §8 file structure to current repo layout, sentence-cased headings throughout to match brand voice. Substantive content of §§1-3, 6-7, 9-10 unchanged.
- **v1.0 (January 2026)**: Initial document. Described 24-item instrument; HUD/CDC frameworks as primary methodology basis.

---

*Document version 1.1 — May 2026*
