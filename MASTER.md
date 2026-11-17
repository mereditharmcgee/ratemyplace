# RateMyPlace Boston — Master Project Document

*Version 1.3 | November 2026*

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
- Ask us and we delete your account and its data, or send you a copy of it

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
- **Overall and domain scores**: An overall score is shown with the unit, building and landlord scores beside it, so readers can see where a place is strong or weak

The total instrument is **27 scored items** (Unit 10 + Building 9 + Landlord 8) plus 5 ancillary supplementary items that capture context but are not fed into the score. Canonical source: `src/lib/surveyItems.ts`.

### Unit rating (10 items, all recommended)

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
- **Tenure**: "How long did you live at this address?" (one of six ranges: less than 6 months, 6-12 months, 1-2 years, 2-3 years, 3-5 years, more than 5 years; stored as 6, 9, 18, 36, 48 or 72 months; preselected to 1-2 years)
- **Move-out timing**: "When did you move out?" (or "I still live here")
- **Housing vouchers**: "To your knowledge, does this property accept Housing Choice Vouchers (Section 8)?"
- **Night safety**: "Was the building and surrounding area safely lit at night?"

Plus an optional review title (100 characters in the form, 200 on the server) and an optional "Additional Comments" field (1,000 characters in the review and edit forms; the server accepts up to 5,000).

### Scoring logic

**Three domain scores plus an overall, for each review:**

1. **Unit score**: the weighted mean of the unit items the reviewer answered
2. **Building score**: the weighted mean of the answered building items (N/A counts as not answered)
3. **Landlord score**: the weighted mean of the answered landlord items
4. **Overall score**: the weighted mean of every answered item, pooled across all three domains (the sum of value times weight over the sum of weight). It is not a blend of the three domain scores. It is stored in `reviews.overall_score` when the review is submitted and again on each edit.

No single item has to be answered, though a review needs at least one answered item in all. A domain score can rest on fewer items than the domain has, and a domain with no answers has no score.

**Item weighting** (`ITEM_WEIGHTS` in `src/lib/scoring.ts`; see also the methodology page):
- **1.5×**: `unit_pests` and `unit_mold`
- **1.3×**: `unit_structural` and `unit_climate`
- **1.2×**: `unit_plumbing` and `building_security`
- **1.0×**: every other item, including all eight landlord items

Weights are set item by item for health and safety risk, not by source instrument. Each raised weight has a one-line health or safety rationale in the comment above `ITEM_WEIGHTS` in `scoring.ts`; the 1.0× items have none. In that comment only pests (Krieger 2002) and mold (Jacobs 2009) cite a source. The methodology page gives a reference for each of the six raised weights.

**Aggregates and recency:** Building, landlord and property manager scores are recency-weighted means of approved reviews (`RECENCY_BANDS`). A review counts at weight 1.0 when it is 0-2 years old, 0.95 at 3 years, 0.90 at 4 and 0.85 beyond. Age is counted from a four-digit move-out year. A current tenant, a "2020 or earlier" answer or a missing move-out falls back to the year the review was submitted. The aggregate overall uses each review's stored `overall_score`, and domain aggregates are recomputed from the items. Aggregates are computed when a page is read; there is no score cache table.

**Minimum thresholds for display:**
- Building scores: shown with 1+ approved review. A building score from 1-2 approved reviews (below `NAMED_PARTY_MIN_REVIEWS`) is shown as an early rating on the building page, in search results and home search suggestions, in the building lists on landlord and property manager pages, and in the map's info window. The number is muted gray with a dot in its band color, and issue and recommend figures on the building page appear as counts, not percentages (`src/lib/earlyRating.ts`). Map pins and the saved-buildings list on a signed-in user's own profile page (`/profile`) still show the plain score in its band color.
- Named-party aggregates (landlords and property managers): shown only with 3+ approved reviews across the named party's portfolio

Every item is recommended, and a review needs at least one answered item, which the form and server check. Only B7, B8, L6 and L7 offer an N/A button. The form still marks the other 23 with the red asterisk that usually means required, but the rating steps never block Continue. Every unanswered item (N/A, skipped, or absent on a legacy or API-written review) is left out of every average and shows on the review card as a muted "Not rated" row, so readers can tell a skipped item from a low score.

For the full methodology including weighting tables, item-level rationale, and academic citations, see the live methodology page (`src/pages/methodology.astro`) and `src/lib/scoring.ts`.

---

## 5. Privacy and safety

### Philosophy

We collect precise data for analysis and moderation but display fuzzy data to protect reviewer identity.

### Data collection vs. display

| Data point | Collected | Displayed | Rationale |
|------------|-----------|-----------|-----------|
| Submission date | Exact timestamp | Never shown. No sitemap date is read from a review (see section 8) | Prevents identification |
| Move-in | Optional month and year. Only the season and year are stored, never the month. `move_in_given` (migration 0035) records which parts were given | Season chip: season and year, or the year alone. On reviews written since migration 0035 (October 27, 2026), a skipped part is never shown. Older reviews (`move_in_given` NULL) show the stored move-in. There a skipped part holds a placeholder (winter for a skipped month, the submission year for a skipped year), and the move-in is dropped only when it would fall after the move-out year | The month is never kept |
| Move-out timing | One choice from the form's list: a recent year, "2020 or earlier", or "I still live here" (the default). The years are hard-coded in `supplementaryItems.moveOutTiming` in `src/lib/surveyItems.ts` | The year in the season chip (for example "Summer 2024 · 2025"), plus a years-ago label from `formatRecency` | Year only |
| Tenure | One of six ranges (preselected to 1-2 years), stored as 6, 9, 18, 36, 48 or 72 months | Never shown on any public page | Context only |
| Unit details | Unit type, monthly rent, bedrooms, bathrooms, square footage | Shown on review cards (rent as $X/mo) | Lets readers compare units |
| Unit number | Optional, private moderation field | Never shown publicly. Admins see it, and the reviewer sees it on their own edit form | See note below |
| IP address | Never stored with a review. Rate limiters keep a keyed hash of the client IP for each limiter's window, never the IP itself, and the audit log keeps admin IPs (see technical protections) | N/A | Privacy protection |
| Reviewer account | Linked in DB | Never shown | Lets the reviewer edit the review and upload proof of address. Reviewers cannot delete a review; only an admin can |

**Note on `reviews.unit_number`:** The column was added in migration `0004_survey_scores.sql` for per-unit grouping of reviews on building pages. Since commit `e003645` it is not shown on any public surface, and building pages group reviews by bedroom count. It is kept as an optional field on the review form and the edit form, labelled "For our moderation team only. Never shown publicly." `POST /api/reviews` and `PATCH /api/reviews/[id]` write it. Only admins see it (review detail and the admin list API), and the reviewer sees it on their own edit form. No migration drops it, and the 2026-08-26 trust-density design keeps it. The earlier plan to drop it around May 14, 2026 lapsed.

### User communication

**Built today, before account creation:** The sign-up page shows links to the Terms of Service and Privacy Policy. Visitors who arrive from "Write a review" also see the building they are reviewing and one line: "Your name and email do not appear on your review and are not given to the landlord."

**Built today, before review submission:** The confirm step shows a "Before you submit" paragraph: "Your landlord may be able to identify you based on details in your review. Avoid mentioning specific dates, unit numbers, or personal details." Submit stays disabled until the reviewer ticks a checkbox that reads "I confirm this review reflects my honest personal experience and agree to the Terms of Service and Review Guidelines." The comments placeholder also asks reviewers to avoid identifying information.

**Planned (from the original spec, not built):**
- Before account creation: a list of what we collect and don't collect, and an anonymized example of how a review will appear
- Before review submission: a checklist of things to avoid (names, unit numbers, specific dates) and a checkbox reading "I understand my landlord may be able to identify me based on details in my review"

### Technical protections

- No IP address is stored with a review. Public limiters write `rate_limits` rows keyed `<endpoint>:<digest>`, where the digest is a keyed hash of the client IP, never the IP itself. Each row is kept for its window: one hour for most public forms, 15 minutes for sign-in, 60 seconds for search, autocomplete, Places and building lookups. Expired rows are purged on a later limiter call. `audit_logs.admin_ip` records the acting admin, the one place an IP is kept. Turnstile also sends the client IP to Cloudflare. Some limiters key on the account or the building instead of the IP, and those are hashed the same way.
- Fuzzy date display: `formatTenancyRange` (`src/lib/privacy.ts`), rendered by `SeasonChip`, shows the move-in season and year and the move-out year. `formatRecency` adds a label counted from the move-out year: "Current tenant", "Past tenant", "Within the last year", "About 1 year ago", "1–3 years ago" and so on up to "10+ years ago". Cards show both.
- Rate limiting to prevent enumeration attacks
- No analytics that track individual users

### Public building records

**Built today:**

- Boston building pages carry a **Public records** panel, server-rendered from records pulled from City of Boston open data: property assessment for the current fiscal year plus five prior years, approved building permits, ISD building and property violations, Public Works code enforcement, 311 service requests from 2011 to the present across both the legacy yearly files and the new system, and RentSmart as a cross-check. Which 311 years the city is serving right now is an operational status; see the records section of [`src/lib/AGENTS.md`](src/lib/AGENTS.md).
- Every rendered value is a field from a primary record or a count of records. No ratio, no comparison, no grade, no color coding, no inference.
- **Records are not part of any score.** Reviews are the judgment layer; the records panel has no opinion.
- Each section shows the date its records were retrieved and links to the dataset it came from. Provenance is stored per pull in `record_pulls`.
- Pulls are admin-triggered, reader-requested (a button that enqueues one pull for the scheduled Worker), or scheduled. Nothing is fetched from a city API on a public page view.
- The reader's button is rate limited per IP and by a site-wide daily cap (`src/lib/records/request.ts`). On a page whose records are more than 30 days old it reads "Ask for newer records", and the finished pull puts the building on the monthly refresh cycle. Approving a review or saving a building also enqueues a pull, but only for a building that has never been pulled.
- The owner of record is shown. The tax mailing address is shown only when the owner is an entity, decided by a word-boundary token rule; an individual named as a trustee is treated as an individual, and the addressee line is shown only when the addressee is itself an entity. A condominium building shows no owner.
- **Owner of record list** (built October 2026): `/owner-of-record?name=` lists an owner's Boston parcels from `building_owners`. The records panel's owner name and landlord search both link to it. An entity can be linked. An individual, or a family or nominee trust, is linked only when at least 2 distinct residential parcels in our data carry the name (`MIN_PARCELS_FOR_PERSON`). Condominiums never link. A refused or unknown name gets the ordinary 404, and the page is noindex and left out of the sitemap.
- A section that has never been queried says "Not retrieved yet" rather than reading as an empty result.
- Anyone can file **Report a record error** from the panel. The form stores the claim and an optional email address, and nothing else about the filer. The only resolution is a re-pull from the source; when the city's own data is wrong, a dated public note is added under that section. Every resolution writes an audit log entry.
- Every whole-building rental parcel in Boston has a page seeded from the assessor (first seeded September 2026), and a sitemap lists them. In an address search, an exact address match ranks first whether reviewed or not; after that, reviewed buildings come before unreviewed ones. Browse mode, landlord queries and the map list reviewed buildings only. A companion Cron Worker fills in the deeper sources city-wide and refreshes the buildings people follow, review, or ask about.

**Planned:**

- **Sub-project B, entity record:** CorpWeb entity records, carrying a manual-verification flag.
- **Sub-project D, neighborhood indicator:** a saved-query peer group and one published indicator built on it.

Design: [`docs/superpowers/specs/2026-09-06-building-records-design.md`](docs/superpowers/specs/2026-09-06-building-records-design.md), [`2026-09-08-boston-coverage-design.md`](docs/superpowers/specs/2026-09-08-boston-coverage-design.md) and [`2026-10-27-owner-of-record-list-design.md`](docs/superpowers/specs/2026-10-27-owner-of-record-list-design.md). Operations and current limits: the records section of [`src/lib/AGENTS.md`](src/lib/AGENTS.md) and [`docs/runbooks/records-scheduler.md`](docs/runbooks/records-scheduler.md).

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
- Lease or rental agreement (sensitive terms may be redacted)
- Utility bill (gas, electric or water)
- Rent receipt or payment confirmation
- Any piece of mail showing the tenant's name and the building's address

This is the upload form's list (`src/components/profile/VerificationModal.tsx`), and the admin checklist on `/admin/verify` matches it.

**Not accepted:** photo IDs (we verify residence, not identity)

### Verification workflow

1. User uploads document to secure temporary storage
2. Moderator reviews: Does address match building?
3. Decision: Approved or Rejected (with reason)
4. Document **immediately deleted** regardless of decision
5. User notified of outcome (**Planned**). Today no notification or email is sent. An approval shows only as the Verified badge. A rejection, and its optional reason, is stored but never shown to the user. The profile shows the same "Verify your tenancy" prompt on every unverified review, whether no document was sent, one is waiting for a decision or one was rejected.

Only the uploaded file is deleted. The `verification_images` row stays, with the content type, size, status, the deciding moderator and any rejection reason. The decision blanks the original filename (to an empty string, as the column is NOT NULL), since a tenant's filename often names their address or unit. The row is removed only when its review or user is deleted.

A file still waiting for a decision does not outlive its review. When an admin deletes a review, or the building it belongs to, the route deletes the review's files from R2 first (`src/lib/verificationFiles.ts`). If R2 refuses one, the failure is logged without the file's key or name, the review or building is still deleted, and the audit entry records how many files were removed and how many failed. Orphan cleanup deletes only buildings with no reviews, so it never has files to remove. No route deletes an account. An account deleted on request is deleted by hand, and any file it still has in R2 must be removed by hand too.

### Security

- Documents stored in encrypted temporary bucket
- Only designated moderators can view
- The admin view is sent with `Cache-Control: private, no-store`, so browsers and proxies are told not to keep a copy
- Automatic deletion after decision, or when the review or its building is deleted
- Audit log of each decision (`verification_approved`, `verification_rejected`), with the admin's id and IP. Logging who viewed a document is **Planned**; viewing is not logged today.

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
- Moderators can reject a review. Rejecting only hides it.
- The reviewer can edit and resubmit a rejected review, which returns it to the pending moderation queue.
- An admin can permanently delete a review through `DELETE /api/admin/reviews/[id]`, audited as `review_deleted` with the old status, author, building, title and score. No admin screen calls this endpoint, so today it is API-only.
- Deleting a building in the admin buildings table also deletes all of its reviews (ON DELETE CASCADE), audited as `building_deleted` with the count.

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
- Submission limits: one review per account per building, at most 5 per account in a rolling 24 hours, and 60 seconds between submissions. A review submit or edit also needs a verified email. Enforcement details are in section 8, Fraud prevention.
- Advisory signals on `/admin/reviews` (possible contact details or links, building bursts, repeat reviewers), computed when the list is read. They never decide approval or visibility and do not reorder the queue. Details are in section 8.

**Planned — automatic prioritization signals:**
- Profanity or slurs (waiting on an owner-approved term list)
- User has previous removed content

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
1. Automatic receipt sent on submission. Reviewed in a reasonable time, with no fixed deadline
2. Compare claims to review content
3. Decision: No action / Flag for detailed review / Remove specific content
4. Notify landlord of outcome (general terms only)

**Built today:** An admin resolves a dispute as `uphold`, `dismiss` or `partially_valid` and must add resolution notes. Resolving changes nothing on the review itself. To remove content, a moderator rejects the whole review (or uses the API-only delete), because moderator editing is not built. The landlord gets an automatic receipt on submission. After the resolution, the landlord gets an outcome email that quotes the admin's resolution notes word for word, so whether it stays in general terms depends on those notes.

A review can be disputed only once (`review_id` is unique in `disputes`), so it cannot be disputed again after a resolution.

**Key principle:** Negative reviews are not removed because a landlord disagrees. Only policy violations warrant removal.

### User notifications

**Built today:** Review approval or rejection attempts to create an in-app notification. When email delivery is configured, rejection also queues an email with any supplied moderator reason and a link to the edit-and-resubmit flow. The reviewer also gets an in-app notification when a landlord disputes their review (`review_disputed`) and when that dispute is resolved (`dispute_resolved`). The profile setting "Email me when my review status changes" is stored in `users.notification_opt_in`. The rejection email is the only email a reviewer gets about a review's status, and it is skipped when they have turned the setting off (`wantsReviewStatusEmail` in `src/lib/notifications.ts`). The in-app notification is written either way.

**Planned:** When a moderator edits or redacts content, the user will receive an email explaining what changed, why, and how to appeal or resubmit.

---

## 8. Technical architecture

### Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Framework | Astro 5.x (SSR + React 18 islands) | Fast, SEO-friendly, islands architecture |
| Hosting | Cloudflare Pages, auto-deploys from `main` | Free tier, global CDN, GitHub integration |
| Database | Cloudflare D1 (SQLite) | Serverless, generous free tier, edge-native |
| Auth | Lucia v3 with the D1Adapter from `@lucia-auth/adapter-sqlite`; email and password, plus Google OAuth | Lightweight, works with D1 |
| Styling | Tailwind CSS 4.x | Utility-first, brand color tokens |
| Language | TypeScript (strict) | Type safety |
| Object storage | Cloudflare R2 | Verification document temporary storage |
| Email | Resend | Transactional email |
| Bot defense | Cloudflare Turnstile | Guards review submission (which is signed in), sign-in, sign-up, forgot-password, contact, bug reports, disputes, and the public records request and record-correction forms |
| Maps and places | Google Maps JavaScript API, Places API (New), `@googlemaps/markerclusterer` | Map view and address autocomplete |
| Scheduled jobs | Cloudflare Cron Worker `ratemyplace-records-scheduler` in `workers/records-scheduler/` | Drains the records queue every minute and plans at 06:00 UTC, sharing the D1 `DB` binding. It deploys separately with `npm run records:worker:deploy`, so pushing `main` does not deploy it |
| Public records | City of Boston open data, through CKAN on data.boston.gov | Source for the building records panel. Admin enrichment also reads the Boston assessor (CKAN) and New Haven's CT CAMA data (data.ct.gov) |
| Tests | Vitest (unit) and Playwright (E2E) | Unit and end-to-end coverage |

New passwords are hashed with PBKDF2-SHA256 (100,000 iterations) through Web Crypto, with `@oslojs` for encoding. `verifyPassword` (`src/lib/password.ts`) still accepts an unsalted SHA-256 hex hash left from before that change and does not rehash it on sign-in. Email verification tokens last 24 hours. Password reset tokens last 1 hour and are single-use.

### Database schema (current production)

The schema is the SQL files in [`migrations/`](migrations/), read in order. Later files alter, rebuild or drop earlier tables and columns. For example, `0025` dropped the three score cache tables, and `0027` dropped 15 legacy `reviews` columns. The production section of `migrations/AGENTS.md` records which files have run on production. Check it before assuming a file has run. For the table-by-table overview, the production apply history and the rules for writing a migration, see [`migrations/AGENTS.md`](migrations/AGENTS.md). [`ARCHITECTURE.md`](ARCHITECTURE.md) describes how the code uses the tables.

**Main table groups:**

| Tables | Hold |
|--------|------|
| `users`, `sessions` | Lucia accounts and sessions: email, an optional password hash (an account created through Google starts with none and can set one later), display name, `is_admin` and `notification_opt_in` |
| `buildings`, `landlords`, `property_managers` | Buildings (address, geo, slug, Google place id, Boston's parcel id and SAM address id, and a `source` of `user` or `seed`) and the named parties linked to them. A building can have both a landlord and a manager |
| `reviews` | One row per review: the 27 item columns, tenancy, unit details, written content, supplementary answers, issue flags, verification and moderation status, and the stored `overall_score` |
| `verification_images`, `verification_tokens`, `password_reset_tokens` | Proof-of-address submissions, and the email verification and password reset tokens |
| `disputes` | Landlord dispute submissions and their resolutions |
| `notifications`, `saved_buildings` | In-app tenant notifications and saved buildings |
| `contact_messages`, `bug_reports` | Inbound forms with admin queues |
| `audit_logs` | Admin actions, old value to new value, with the acting admin's id and IP |
| `rate_limits` | Rate limiter rows, keyed `<endpoint>:<digest>` and windowed. The digest is a keyed hash of the IP, account or building, never the raw value |
| `record_pulls`, `building_records`, `record_corrections`, `records_queue`, `building_owners` | Public building records: per-run provenance, typed record payloads, "report a record error" claims, the pull queue the Cron Worker drains, and the assessor's owner of record |
| `app_settings` | Key/value operator settings: the records pipeline's keys (`records_fill_paused`, the breaker state and the last fixture result; `SETTING_KEYS` in `src/lib/records/settings.ts`) and the site's email-health and owner-notice records (`SITE_SETTING_KEYS` in `src/lib/siteSettings.ts`) |

Scores are computed when a page is read, from approved reviews (`src/lib/scoring.ts`, with its SQL mirror in `src/lib/scoring-sql.ts`). There is no score cache table, and adding one back needs a deliberate decision.

**Facts that matter for privacy:**
- Review rows hold no IP. `rate_limits` holds a keyed hash of each limiter's identifier (the client IP, an account or a building), never the raw value. Each of those rows expires at the end of its limiter's window (at most one hour), but expired rows are deleted only when a later limiter check runs, so a row can outlast its window when the site is quiet. `audit_logs.admin_ip` keeps each acting admin's IP permanently. The review-submit limiter is keyed on the account, not the IP.
- `reviews.unit_number` is a private moderation field and is kept (see section 5).
- Through the review and edit forms, tenancy is stored coarsely: `tenure_months` holds one of six bucket values and `move_out_year_new` holds `current`, a year or `2020_or_earlier`. Neither route checks these values against those lists, and the columns have no CHECK constraint, so a hand-made request can store other values. Move-in keeps only the season and year. A part the reviewer skipped holds a placeholder (winter, the current year) in the NOT NULL `move_in_year` and `move_in_season` columns, and `move_in_given` (0035) tells public pages which parts to show; it is NULL on reviews written before it existed. `move_out_season` is set only on reviews written before January 2026.
- A verification document is deleted from R2 at the decision, or earlier if its review or building is deleted. After a decision its `verification_images` row stays, with the filename blanked.
- A building's sitemap `lastmod` is the later of `buildings.updated_at` and its newest records pull. Landlord entries carry none, and no sitemap date is read from a review. The date can still land near a review: a building a reviewer adds is created just before the review, linking a landlord during moderation bumps `updated_at`, and approving a review of a building with no deeper records queues a pull that runs about a minute later.
- `users.notification_opt_in` (default 1) turns off the review rejection email when it is 0. In-app notifications do not read it.

**Other things to know:**
- Four of the 27 item columns accept N/A, stored as NULL and left out of every aggregate: `building_laundry`, `building_parking`, `landlord_deposit` and `landlord_rent_practices`. Every item column allows NULL.
- `audit_logs.action_type` and `entity_type` each carry a CHECK list. A new action type needs a table-rebuild migration in the same change. Otherwise the audit insert fails the CHECK, the admin action still succeeds, the audit row is lost, and the only trace is an `audit_log_write_failed` log line. The table is insert-only by convention; no trigger enforces it.
- Despite its name, `0021_reserved.sql` creates the `notifications` table and adds `users.notification_opt_in`. `0005`, `0017` and `0022` are `SELECT 1;` placeholders.
- **Dormant columns and tables.** These exist, but nothing in `src/` or `workers/` reads or writes them, so do not assume the features exist: `reviews.has_onsite_manager`; `reviews.moderated_at` and `moderated_by` (the approval time is only in `audit_logs`); `reviews.rejection_reason` (the moderator's reason is stored in `moderation_notes`); `reviews.laundry_wash_cost` and `laundry_dry_cost`; `buildings.public_info`; `landlords.owner_entity`; `total_units` and `verified` on both `landlords` and `property_managers`; `property_managers.admin_notes`; and the `review_votes` table (there is no helpful-vote feature).

**Applying migrations.** Locally, `npm run db:migrate:local` (and `npm run db:fresh` through it) runs `npx wrangler d1 migrations apply ratemyplace-db --local`. Production is different. `0025` to `0027` were applied in the Cloudflare dashboard console, and `0028` onward by hand, one file at a time, with `npx wrangler d1 execute ratemyplace-db --remote --file <file>`. Wrangler's migration tracking does not know they ran, so never run `migrations apply --remote` blindly. `0027` (DROP COLUMN) and the ADD COLUMN files `0029`, `0031` and `0035` fail if re-run. `0028` and `0030` rebuild `audit_logs` and must not be re-run either. Check the live schema first, and read the production section of [`migrations/AGENTS.md`](migrations/AGENTS.md).

### File structure (current)

A short map, without per-file lists. For full listings use `git ls-files`. For conventions read [`AGENTS.md`](AGENTS.md) and the nested guides it lists.

**Three deployables:**
- **The site** (repo root and `src/`): Astro on Cloudflare Pages. Its config is `wrangler.jsonc`, with the `DB` and `VERIFICATION_BUCKET` bindings. Pushing `main` deploys it.
- **The records Cron Worker** (`workers/records-scheduler/`): its own `wrangler.jsonc`, deployed with `npm run records:worker:deploy`. See its README and [`docs/runbooks/records-scheduler.md`](docs/runbooks/records-scheduler.md).
- **The data dashboard** (`dashboard/`): a separate static page of City of Boston housing records, built by a Python pipeline and a Vite, Preact and Leaflet web app, with its own `dashboard/web/wrangler.jsonc`. Its nightly workflow deploys an unlisted `workers.dev` preview unless the repository variable `DASHBOARD_DEPLOY_TARGET` is `production`, and every build is `noindex` unless `DASHBOARD_INDEXABLE=1`. Nothing in `src/` imports it. See `dashboard/README.md`.

**Inside `src/`:**
- `components/`: Astro components and React islands, grouped by feature (reviews, ratings, search, records, admin, profile, auth, layout, ui and others). Guide: [`src/components/AGENTS.md`](src/components/AGENTS.md).
- `pages/`: routes. Public pages, `admin/` (the moderation panel, including `/admin/records`), `api/` (the API routes), and the sitemap and robots endpoints (`sitemap.xml.ts`, `sitemaps/`, `robots.txt.ts`). API route rules are in root `AGENTS.md`.
- `lib/`: scoring, survey items, auth, validation, email, rate limiting, review limits and moderation signals, `enrichment/` (Boston assessing and New Haven CT CAMA lookups for the admin buildings table; never auto-saved), and `records/` (city sources, queue, scheduler and seed). Guide: [`src/lib/AGENTS.md`](src/lib/AGENTS.md).
- `styles/global.css`: the Tailwind 4 tokens and theme (`@theme`). There is no Tailwind config file; Tailwind runs through the `@tailwindcss/vite` plugin in `astro.config.mjs`.
- `middleware.ts`: Lucia session check and security headers.

**Other top-level folders:**
- `migrations/`: the D1 schema, read in order. Guide: [`migrations/AGENTS.md`](migrations/AGENTS.md).
- `e2e/`: Playwright tests. Vitest unit tests live under `src/`.
- `scripts/`: the local dev database and seed, the records seed and backfills, the records fixture check, the CI audit check, the smoke test, ops metrics and the OG image renderer.
- `public/`: `_headers`, favicons, logos and `public/brand/`, which holds the served OG image. Nothing here generates anything. The OG image is rendered from `brand/social/og-default.html` by `npm run og:render`, and both PNG copies are committed.
- `brand/`: logo SVGs and social assets.
- `docs/`: runbooks (`docs/runbooks/`), design specs (`docs/superpowers/`) and archived docs (`docs/archive/`).
- `.planning/`: phase plans, audits and milestone docs (internal).
- `.github/workflows/`: CI, dashboard CI, the dashboard nightly refresh and the post-deploy smoke check. Release checks: `.github/workflows/ci.yml` and [`docs/runbooks/release-smoke.md`](docs/runbooks/release-smoke.md).
- `ops/`: non-code work. Guide: `ops/AGENTS.md`.

**Root docs and config:** `AGENTS.md` is the canonical agent guide; nested `AGENTS.md` files in `src/lib/`, `src/components/`, `migrations/` and `ops/` override it where they overlap. `CLAUDE.md` is a short pointer to `AGENTS.md` plus Claude Code specifics. `ARCHITECTURE.md` is the technical architecture reference. `brand.md` is the Brand Handbook: voice, values, color, typography, logo use, components, imagery, motion and social, plus the Tailwind tokens and component classes that implement them. It is the code-level companion to a separate brand bible, which is canonical where the two disagree. `MASTER.md` is this document. Also at the root: `README.md`, `SECURITY.md`, `GOOGLE_OAUTH_TROUBLESHOOTING.md`, `astro.config.mjs`, `wrangler.jsonc`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts` and `audit-allowlist.json`.

### Fraud prevention

**Built today:**
- An account needs a verified email to submit or edit a review or to create a building (`hasVerifiedEmail` in `src/lib/emailVerification.ts`). Without one the route returns 403 `email_verification_required`, checked before any D1 statement.
- One review per account per building, forever (built 2026-11-14). `POST /api/reviews` writes with `INSERT ... SELECT ... WHERE ${REVIEW_GUARD_SQL}` (`src/lib/reviewLimits.ts`). If the account already has a review of that building, in any status, nothing is written and the route returns 409 `already_reviewed` with an `editPath`. An admin deletion frees the slot.
- At most `REVIEW_DAILY_LIMIT` (5) reviews per account in a rolling 24 hours (429 `daily_limit`), and `REVIEW_SUBMIT_PAUSE_SECONDS` (60) between one account's submissions. Both are enforced inside the same guarded insert.
- The `review-submit` limiter (10 attempts per account per hour) still runs before the guarded insert.
- Building creation is limited per account (the `building-create` limiter).
- Email and password sign-up is limited per IP (the `signup` limiter, 3 per hour). Google OAuth creates accounts in its callback with no app rate limit and no Turnstile.
- Public forms and lookups are rate limited per IP through `checkRateLimit` (`src/lib/rateLimit.ts`): sign-in, forgot and reset password, verification resend, contact, disputes, bug reports, record corrections, search, Places and building lookup. Each limiter's key, count and window sit at its call site under `src/pages/api/`. The stored key is a keyed hash of the IP or account, never the raw value.
- The records request button is limited per IP and by a site-wide daily cap (`REQUEST_PER_IP` and `REQUEST_DAILY_CAP` in `src/lib/records/request.ts`).
- The server validates Cloudflare Turnstile on sign-up, sign-in, forgot-password, contact, dispute, bug-report, review-submission, record-correction and records-request forms.
- A review that is at least the fifth review of its building in the 24 hours up to its own submission shows the advisory `building_velocity` badge on `/admin/reviews`; the first four in a burst do not (`BUILDING_VELOCITY_MIN` and `VELOCITY_WINDOW_SECONDS` in `src/lib/reviewFlags.ts`, built 2026-11-14). The other advisory badges are `possible_email`, `possible_phone` and `possible_link`, for a possible email address, phone number or web link in the title, text, comments, landlord name or manager name, and `repeat_reviewer`, for an account with more than one review of the same building (each of those reviews shows it).
- The signals are computed when the list is read and never stored. They never change a review's status, send no notice and do not reorder the queue, which stays newest first.

**Planned — tighter limits and integrity controls:**
- Tighten account creation to 3 per IP per 24 hours. Google OAuth sign-up has no limit today, so this needs a decision on that path too.

**Planned — velocity alerts that flag for human review:**
- 10+ reviews for same landlord in 24 hours

**Planned — additional bot detection:**
- Honeypot fields where applicable
- Minimum-time submission check

---

## 9. Legal and policy

### Interim terms of service (summary)

The published terms are at `/terms` (`src/pages/terms.astro`).

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

**Your rights:** Ask us and we delete your account and its data, reviews included, or send you a copy of it. You can edit your own reviews

### Future legal review

Flag for eventual lawyer review:
- Section 230 protections
- Defamation liability
- Massachusetts consumer protection laws
- CCPA/GDPR applicability

---

## 10. Development phases

The phase lists below are the original plan, ticked as items shipped. Milestone tracking since February 2026 lives in [`.planning/ROADMAP.md`](.planning/ROADMAP.md). It lags behind merged work in places, so check git history when the two disagree. The open goals in Phase 3 are not tracked there, so they stay here.

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

- [x] Email verification before posting (enforced on review writes and building creation since #86, November 14, 2026)
- [x] Verification document upload and review
- [x] Moderation queue
- [x] Flagging system: moderators can set a review to `flagged`, and since 2026-11-14 `/admin/reviews` shows advisory moderation signals. Readers cannot flag or report a review yet (see section 7, "User reports").
- [x] Landlord dispute form

### Phase 3: Community and scale

- [ ] Partner organization feedback incorporated
- [x] Public records integration (Boston only: assessment, permits, violations, code enforcement, 311, RentSmart and owner of record)
- [ ] Data export for advocacy orgs (`dashboard/` exports city records as CSV, not review data)
- [ ] Additional neighborhoods/cities (partly built: every Boston neighborhood has assessor-seeded pages, and reviews are accepted for any US address. New Haven has assessor enrichment but no city records source)
- [ ] Multi-language support (when budget allows)

### Shipped outside the original phases

- Map view and Google OAuth sign-in (in the repo from January 2026)
- Saved buildings and in-app notifications (March 2026)
- Boston public records panel, assessor-seeded pages for every whole-building rental parcel, and the records Cron Worker (September 2026)
- Owner of record list (October 2026)
- Review limits with advisory moderation signals (#88), November 14, 2026

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

- **v1.3 (November 17, 2026)**: Owner-approved wording. §3 and §9: deleting an account and its data, or sending a copy, is on request, as the privacy page says. §4: the overall score is shown with the three domain scores beside it, and every item is recommended, with at least one answered item needed. §6: the accepted documents are the upload form's list, and photo IDs are still not accepted. §7: a dispute gets an automatic receipt and has no fixed review deadline, as the Terms say. Built-today text updated for the November 17 privacy fixes: rate limiter keys are a keyed hash, sitemap dates no longer come from reviews, the email setting is honored, and verification files go with their review or building, are not cached and lose their filename at the decision.
- **v1.2 (November 17, 2026)**: Checked the built-today text against the code. §4: tenure ranges, title and comment limits, and scoring logic as coded (per-item weights, pooled overall, recency bands, early ratings, unenforced required items and "Not rated" rows). §5: collection-vs-display table corrected (move-in row, coarse move-out and tenure, unit details, IP scope, reviewer account), `unit_number` kept as a private field with no drop planned, sign-up and pre-submit copy as built (the unbuilt items kept as Planned), records request behavior, owner of record list, search order, seed page count removed. §6: no outcome notification yet; only decisions are audited; the submission row outlives the file. §7: admin review delete and building cascade, submission limits and advisory signals now built, dispute outcomes and notifications as built. §8: stack table completed (password auth, email, Turnstile, maps, Cron Worker, records source, tests); the column-by-column schema and the file tree replaced with short summaries that point to `migrations/`, `migrations/AGENTS.md` and `ARCHITECTURE.md`; fraud prevention split corrected. §9: pointer to the published terms. §10: pointer to `.planning/ROADMAP.md`, Phase 2 and 3 items reworded, shipped work listed. Policy statements that disagree with the code were raised with the owner, not changed here.
- **November 17, 2026 (earlier the same day, unversioned)**: File tree pointed at `AGENTS.md` after older root docs were archived; public records checkbox ticked in §10.
- **September 10, 2026 (unversioned)**: §5 public records as built for Boston coverage: reader-requested pulls, assessor-seeded pages for every whole-building rental parcel, and the companion Cron Worker.
- **September 7, 2026 (unversioned)**: Added the public building records section to §5.
- **August 26, 2026 (unversioned)**: Split built from planned features in §§3, 7 and 8, and set the named-party display threshold (3+ approved reviews).
- **v1.1 (May 2026)**: Updated 24→27 item instrument count, aligned schema with production (current through migration 0024), documented `unit_number` deprecation in §5 and §8, named OHQS / PHQS / WHO LARES as primary instruments in §4, refreshed §8 file structure to current repo layout, sentence-cased headings throughout to match brand voice. Substantive content of §§1-3, 6-7, 9-10 unchanged.
- **v1.0 (January 2026)**: Initial document. Described 24-item instrument; HUD/CDC frameworks as primary methodology basis.

---

*Document version 1.3 | November 2026*
