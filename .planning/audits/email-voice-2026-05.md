# Email surfaces audit — voice alignment

*Date: 2026-05-01 · Scope: `src/lib/email.ts` (6 templates) + `src/lib/notifications.ts` (4 in-app messages, mentioned for completeness, not email) · Outcome: recommendations only — no code changes in this commit.*

---

## Inventory

All transactional email sending happens in `src/lib/email.ts`. Seven other files (`api/disputes.ts`, `api/contact.ts`, `api/auth/{resend-verification,forgot-password,signup}.ts`, `api/disputes/[id].ts`, `env.d.ts`) import these helpers but contain no inline templates of their own. Confirmed via grep for `resend.emails.send` — single match.

**Six email templates are wired:**

| # | Function | Trigger | Recipient |
|---|----------|---------|-----------|
| E1 | `sendVerificationEmail` | New account signup | New user |
| E2 | `sendPasswordResetEmail` | Forgot-password form submitted | User who forgot password |
| E3 | `sendDisputeConfirmationEmail` | Landlord submits a dispute via `/dispute` form | Landlord (submitter) |
| E4 | `sendContactConfirmationEmail` | User submits the contact form | User (submitter) |
| E5 | `sendContactNotificationEmail` | Same as E4, in parallel | `contact@ratemyplace.org` (admin) |
| E6 | `sendDisputeUpheldEmail` | Admin marks dispute "upheld" via admin panel | Landlord |

**Templates the brief speculated about that DON'T exist:**

- Review submitted confirmation — never emailed (no template, no caller)
- Review approved / rejected to reviewer — never emailed (in-app notification only, see `notifications.ts` `EVENT_MESSAGES`)
- Verification document approved / rejected — never emailed (admin acts in panel; tenant sees status change on their profile)
- Dispute resolution outcomes other than "upheld" — `sendDisputeUpheldEmail` is the only outcome wired; "dismiss" and "partially_valid" outcomes don't email the landlord at all

This is a meaningful gap separate from voice. Flagged at end of report under "Coverage gaps."

**Adjacent surface (not email):** `src/lib/notifications.ts` exports `EVENT_MESSAGES` for four in-app notification types (`review_approved`, `review_rejected`, `review_disputed`, `dispute_resolved`). These render in the in-app notification dropdown, not in email. The current copy is short and clean — no recommended changes there beyond what's noted in the "in-app notifications" section at the bottom.

---

## Cross-cutting voice issues (apply to most templates)

These show up repeatedly. Calling them out once here, then referencing back in each template review.

### V1. Title Case where sentence case is the brand standard
Per brand.md §2 voice principles and the case-rule work shipped in cfb0aff/98cfef5. Affects subject lines, H2 headings, button labels, and bold inline labels. Examples:
- Buttons: "Verify Email Address", "Reset Password"
- H2s: "Reset Your Password", "New Contact Form Submission"
- Inline bold labels: "Dispute Reasons:", "Resolution Notes:", "Additional Explanation:"
- Subject suffixes: "Dispute Submitted - RateMyPlace Boston", "Dispute Resolution - RateMyPlace Boston"

### V2. Em dash in body copy
Brand voice forbids em dashes (we agreed earlier this session). One real em dash currently in body:
- E4 footer: "Please do not reply to this automated email — use the contact form…"

### V3. Subject-line suffix `- RateMyPlace Boston`
Three subjects append " - RateMyPlace Boston". The from-name is already `RateMyPlace Boston <noreply@…>` so the suffix is redundant noise in the subject line. Inboxes show sender + subject side by side — recipients already know who it's from. The two cleaner subjects (E1 "Verify your email address", E2 "Reset your password") drop the suffix and read better.

### V4. "Welcome to RateMyPlace Boston!" + exclamation point
E1 opens with this. Reads as marketing-speak / startup welcome-mat. Brand voice §2: "Short, declarative, unornamented." Compare the do/don't table: "Share your rental journey!" is the prototypical bad example. Same energy.

### V5. "Dear ${name}" greeting
E3 and E6 (both landlord-facing) use "Dear". Reads as overly formal / obsequious to a counterparty in a dispute. Brand voice would prefer "Hi ${name}" (E4 already does this) or just dropping the greeting and starting with the substance.

### V6. "Thank you for…" filler sentences
Multiple templates close with a "thank you for [helping us / bringing this to our attention / making us better for everyone]" line. These are filler — they don't tell the recipient anything new. Brand voice §2 principle 2: "Short, declarative, unornamented. Every clause a hammer." Recommend cutting these where they're decorative; keep them only where they're load-bearing (e.g., the landlord just submitted a real piece of work via the dispute form — a genuine acknowledgment is fine, but it should be one short sentence, not a closer + a footer-thanks).

### V7. Internally inconsistent reply policy
- E4 body says: "If your matter is urgent, please reply to this email and include 'URGENT' in the subject line."
- E4 footer says: "Please do not reply to this automated email — use the contact form…"
- All emails are sent from `noreply@ratemyplace.org`.

This contradicts itself. Either (a) `noreply@` is configured to forward replies to `contact@` (in which case the footer's "do not reply" is wrong), or (b) it isn't (in which case the body's "reply with URGENT" is misleading and the user's reply will bounce). Recommend resolving with operations before next E4 send. Most defensible default: drop the "reply with URGENT" instruction, keep the footer.

### V8. Startup vocabulary
Mostly clean already. One catch: "Our admin team will carefully review your dispute" (E3). "Carefully" is filler, and "Our admin team" is more corporate than necessary. Brand voice prefers "we" as the actor.

---

## Per-template recommendations

For each: current copy → proposed copy → rationale.

---

### E1 — `sendVerificationEmail`

**Trigger:** New user completes signup. Token expires in 24h.
**Subject (current):** `Verify your email address` ✓ already brand-correct
**From:** `RateMyPlace Boston <noreply@ratemyplace.org>`

**Current body (key elements):**
- H2: `Welcome to RateMyPlace Boston!`
- Lede: `Please verify your email address to get the verified badge on your reviews.`
- CTA button: `Verify Email Address`
- Plain link fallback (good)
- Expiration note: `This link will expire in 24 hours.` ✓ clear
- Footer: `If you didn't create an account on RateMyPlace Boston, you can safely ignore this email.` ✓ correct

**🚩 FACTUAL ERROR (high priority, not just voice):**
The lede says verifying gets the user "the verified badge on your reviews." This is wrong. Per `MASTER.md §6`, the verified badge requires a **document upload** (utility bill, lease, etc.) reviewed by a moderator — that's the higher tier. Email verification is the **base tier** required to post a review at all. Telling users "verify to get the badge" misleads about what they're getting.

**Recommended changes:**

| Element | Current | Proposed | Rationale |
|---|---|---|---|
| H2 | `Welcome to RateMyPlace Boston!` | `Verify your email` | V1 (sentence case) + V4 (drop welcome-mat). Mirrors the subject line. |
| Lede | `Please verify your email address to get the verified badge on your reviews.` | `Confirm your email so you can post reviews. The next tenant is reading.` | Fixes the factual error about the badge. Adds a beat of mission ("the next tenant is reading") in voice — pulls from brand do/don't ("Write a review. The next tenant will read it."). |
| Button | `Verify Email Address` | `Verify email` | V1. Shorter, no Title Case. |
| Expiration | `This link will expire in 24 hours.` | (keep) | Already clear. |

**Brand principles applied:** V1 (sentence case), V4 (no exclamation/welcome-mat), §2 #2 (short declarative), §2 #3 (specific over sweeping — "the next tenant is reading" is concrete), and a factual correctness fix.

---

### E2 — `sendPasswordResetEmail`

**Trigger:** Forgot-password form submitted. Token expires in 1h.
**Subject (current):** `Reset your password` ✓ already brand-correct

**Current body:**
- H2: `Reset Your Password`
- Lede: `We received a request to reset your password for your RateMyPlace Boston account.`
- CTA button: `Reset Password`
- Plain link fallback (good)
- Expiration: `This link will expire in 1 hour.` ✓ clear, urgency-styled in red
- Footer: `If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.` ✓ good

**Recommended changes:**

| Element | Current | Proposed | Rationale |
|---|---|---|---|
| H2 | `Reset Your Password` | `Reset your password` | V1. |
| Lede | `We received a request to reset your password for your RateMyPlace Boston account.` | `Someone requested a password reset for your account. If that wasn't you, ignore this email.` | "for your RateMyPlace Boston account" is redundant (they know whose account; the email is in their inbox). Combining the lede with the safety note is tighter. |
| Button | `Reset Password` | `Reset password` | V1. |
| Footer | (keep, or merge into lede above) | `Your password won't change unless you click the link.` | Optional — if the lede is rewritten as proposed, the footer becomes partially redundant. This shorter version reinforces the safety guarantee in active voice. |

**Brand principles applied:** V1, §2 #2 (short declarative), §2 #5 (direct).

---

### E3 — `sendDisputeConfirmationEmail`

**Trigger:** Landlord submits the dispute form at `/dispute`.
**Subject (current):** `Dispute Submitted - RateMyPlace Boston`
**From:** `RateMyPlace Boston <noreply@ratemyplace.org>`

**Current body:**
- H2: `Thank you for submitting your dispute`
- Greeting: `Dear ${landlordName},`
- Body: `We have received your dispute for the review at <strong>${buildingAddress}</strong>.`
- Inline panel: `Dispute Reasons:` + bulleted list, optionally `Additional Explanation:` + paragraph
- Closer: `Our admin team will carefully review your dispute. If the dispute is upheld, you will receive a notification email with the resolution details.`
- Sign-off: `Thank you for helping us maintain accurate information on RateMyPlace Boston.`
- Footer: `This is a confirmation of your dispute submission. For questions, please contact us through the website.`

**Voice notes:**
- Subject is Title Case + has the redundant suffix (V1, V3)
- Greeting is "Dear" (V5)
- "Our admin team will carefully review" — "carefully" is filler (V8)
- "If the dispute is upheld, you will receive a notification email" — accurate but cold; also inadvertently flags that a dismissed dispute won't get an email (the coverage gap)
- "helping us maintain accurate information" — soft framing. Disputes are about fairness, not accuracy. Reviews can be valid opinions even if a landlord disagrees.
- Sign-off is V6 filler

**Recommended changes:**

| Element | Current | Proposed | Rationale |
|---|---|---|---|
| Subject | `Dispute Submitted - RateMyPlace Boston` | `We received your dispute` | V1, V3, mirrors E4 subject pattern. |
| H2 | `Thank you for submitting your dispute` | `We received your dispute` | V1, V6. |
| Greeting | `Dear ${landlordName},` | `Hi ${landlordName},` | V5. |
| Body | `We have received your dispute for the review at <strong>${buildingAddress}</strong>.` | `Your dispute about the review at <strong>${buildingAddress}</strong> is in our queue.` | More specific ("in our queue") tells them what state the request is in. Active voice. |
| Panel headers | `Dispute Reasons:` / `Additional Explanation:` | `Reasons cited:` / `Your explanation:` | V1 + tightens. |
| Closer | `Our admin team will carefully review your dispute. If the dispute is upheld, you will receive a notification email with the resolution details.` | `We'll review and follow up by email with the outcome — whether we uphold, partially uphold, or dismiss the dispute.` | V8 (cuts "carefully", swap "Our admin team" for "we"). Also surfaces all three possible outcomes so the landlord knows they'll hear back regardless. **This requires fixing the coverage gap below — currently dismiss/partially_valid don't email.** |
| Sign-off | `Thank you for helping us maintain accurate information on RateMyPlace Boston.` | (cut entirely) | V6 filler. The body and closer carry the weight. |
| Footer | `This is a confirmation of your dispute submission. For questions, please contact us through the website.` | `Sent automatically. Reach us via the contact form at ratemyplace.org/contact for follow-ups.` | Active voice. Specific URL. Resolves V7 contradiction by being explicit about the right channel. |

**Brand principles applied:** V1, V3, V5, V6, V8.

---

### E4 — `sendContactConfirmationEmail`

**Trigger:** User submits the contact form. Categories: general, privacy, support, landlord.
**Subject (current):** `We received your message - RateMyPlace Boston`
**From:** `RateMyPlace Boston <noreply@ratemyplace.org>`

**Current body:**
- H2: `We received your message` ✓ already sentence case
- Greeting: `Hi ${toName},` ✓ already brand
- Body: `Thank you for reaching out. We've received your ${categoryLabel} and will get back to you as soon as possible.`
- Closer: `Our team typically responds within 2-3 business days. If your matter is urgent, please reply to this email and include "URGENT" in the subject line.`
- Sign-off: `Thank you for helping us make RateMyPlace Boston better for everyone.`
- Footer: `This is a confirmation that we received your message. Please do not reply to this automated email — use the contact form at ratemyplace.org/contact to send additional messages.`

**Voice notes:**
- Subject has the redundant suffix (V3)
- "Thank you for reaching out" — V6 filler
- The "reply with URGENT" + footer "do not reply" contradiction (V7) is the most user-confusing item in the whole email surface
- Sign-off is V6 filler
- Footer has a real em dash (V2)
- "matter" is mildly corporate

**Recommended changes:**

| Element | Current | Proposed | Rationale |
|---|---|---|---|
| Subject | `We received your message - RateMyPlace Boston` | `We received your message` | V3. |
| Body | `Thank you for reaching out. We've received your ${categoryLabel} and will get back to you as soon as possible.` | `We've got your ${categoryLabel} and will reply within 2-3 business days.` | V6 (drop "Thank you for reaching out"). Promise the timeline up front instead of in a separate "closer" sentence. |
| Closer | `Our team typically responds within 2-3 business days. If your matter is urgent, please reply to this email and include "URGENT" in the subject line.` | (cut — fold timeline into body above; remove urgency-reply pathway) | V7. The reply pathway is broken (`noreply@` doesn't accept replies) so removing it stops promising something we don't deliver. If urgency triage matters, add a category for it on the form itself. |
| Sign-off | `Thank you for helping us make RateMyPlace Boston better for everyone.` | (cut entirely) | V6. |
| Footer | `This is a confirmation that we received your message. Please do not reply to this automated email — use the contact form at ratemyplace.org/contact to send additional messages.` | `Sent automatically. Send follow-ups via ratemyplace.org/contact.` | V2 (em dash gone). Tighter. |

**Brand principles applied:** V2, V3, V6, V7.

---

### E5 — `sendContactNotificationEmail`

**Trigger:** Same form submission as E4, sent in parallel to admin.
**Recipient:** `contact@ratemyplace.org` (Meredith / admin)
**Subject (current):** `New contact: ${category} from ${submitterName}` ✓ already clean

**Current body:**
- H2: `New Contact Form Submission`
- Inline panel with Name / Email / Category / Message preview
- Link to admin panel
- Footer: `This is an automated admin notification from RateMyPlace Boston.`

**Voice notes:**
- This is admin-internal, so the bar is "functional and scannable," not "in voice." Most of it is already fine.
- The H2 is Title Case (V1). Worth fixing for consistency, but lower priority than user-facing surfaces.

**Recommended changes (low priority):**

| Element | Current | Proposed | Rationale |
|---|---|---|---|
| H2 | `New Contact Form Submission` | `New contact form submission` | V1. |
| Panel labels | `Name:` `Email:` `Category:` `Message preview:` | (keep) | These are functional labels, fine as-is. |
| Footer | `This is an automated admin notification from RateMyPlace Boston.` | (keep) | Functional. |

**Brand principles applied:** V1.

---

### E6 — `sendDisputeUpheldEmail`

**Trigger:** Admin marks a dispute "upheld" in `/admin/disputes`. **Only fires for the upheld outcome — dismiss and partially_valid currently send nothing.** (See coverage gaps below.)
**Subject (current):** `Dispute Resolution - RateMyPlace Boston`
**From:** `RateMyPlace Boston <noreply@ratemyplace.org>`

**Current body:**
- H2: `Your dispute has been reviewed`
- Greeting: `Dear ${landlordName},`
- Lede: `After careful review, we have <strong>upheld your dispute</strong>. The review in question has been addressed according to our policies.`
- Inline panel: `Resolution Notes:` + admin's notes
- Closer: `The appropriate action has been taken based on our review of your dispute.`
- Sign-off: `Thank you for bringing this to our attention and helping us maintain the integrity of RateMyPlace Boston.`
- Footer: `This is a resolution notification for your dispute. For questions, please contact us through the website.`

**Voice notes:**
- Subject is Title Case + redundant suffix (V1, V3)
- Greeting is "Dear" (V5)
- "After careful review" + "carefully review" + "appropriate action" + "according to our policies" all read as legal-corporate hedging. Brand voice is direct.
- Closer ("The appropriate action has been taken based on our review") is empty calories — passive voice, no information beyond what was already said. The Resolution Notes panel carries the actual content.
- Sign-off is the longest V6 filler in the file ("Thank you for bringing this to our attention and helping us maintain the integrity of…")

**Recommended changes:**

| Element | Current | Proposed | Rationale |
|---|---|---|---|
| Subject | `Dispute Resolution - RateMyPlace Boston` | `We upheld your dispute` | V1, V3. Active voice. Tells the recipient the outcome from the subject line — no need to open the email to learn what happened. |
| H2 | `Your dispute has been reviewed` | `We upheld your dispute` | V1. Match the subject. Stronger than passive "has been reviewed". |
| Greeting | `Dear ${landlordName},` | `Hi ${landlordName},` | V5. |
| Lede | `After careful review, we have <strong>upheld your dispute</strong>. The review in question has been addressed according to our policies.` | `We've upheld your dispute. The review has been updated according to our content guidelines (link).` | V8 (cuts "After careful review", "according to our policies"). Links to the public guidelines page so the recipient can verify the standard applied. |
| Closer | `The appropriate action has been taken based on our review of your dispute.` | (cut entirely) | Empty calories. The lede + Resolution Notes panel cover this. |
| Sign-off | `Thank you for bringing this to our attention and helping us maintain the integrity of RateMyPlace Boston.` | (cut entirely) | V6. |
| Footer | `This is a resolution notification for your dispute. For questions, please contact us through the website.` | `Sent automatically. Reach us via ratemyplace.org/contact.` | Match E3/E4 footer convention. |

**Brand principles applied:** V1, V3, V5, V6, V8.

---

## Coverage gaps (separate from voice)

These aren't voice issues but came up while inventorying. Worth flagging for product decisions before doing voice updates, because filling them shapes the voice work.

### CG1. Dispute outcomes other than "upheld" send nothing
`disputes` table has three resolution outcomes: `uphold`, `dismiss`, `partially_valid`. Only `uphold` triggers an email (`sendDisputeUpheldEmail`). A landlord whose dispute is dismissed gets no email — they have to check back to find out. Recommendation: add `sendDisputeDismissedEmail` and `sendDisputePartiallyValidEmail`, OR genericize `sendDisputeUpheldEmail` into `sendDisputeResolvedEmail(outcome, notes)` with branching copy. Either way, the landlord needs to hear the outcome regardless of which way it goes — silence reads as the system being unresponsive. Doing this also lets E3's "we'll follow up with the outcome" promise be honest.

### CG2. Reviewer notifications are in-app only
When a review is approved, rejected, or disputed, the reviewer gets an in-app notification (via `notifications.ts`) but no email. For approvals this is probably fine (low urgency, they'll see it next visit). For rejections it's a problem — a tenant who put real time into a review and gets it rejected may never log back in to find out. Recommendation: at least email on review_rejected with the rejection reason. Lower priority but worth a decision.

### CG3. Verification document outcomes are not emailed
Same shape as CG1/CG2 — when a moderator approves or rejects a verification document, the tenant sees the badge change on their profile but doesn't get an email. The badge change is silent. Recommendation: email at least on rejection with the reason (since it requires action — re-uploading), and ideally on approval too (so they know the badge is now showing).

### CG4. `noreply@ratemyplace.org` reply behavior is unclarified
E4 contradicts itself about whether replies are accepted. Need to either (a) configure forward-to-admin on `noreply@` and update copy, or (b) leave it as-is and remove all "reply to this email" instructions everywhere. Per MEMORY.md the catch-all is forwarded — check whether `noreply@` specifically is part of that or excluded.

---

## In-app notifications (`src/lib/notifications.ts` — for completeness, not email)

These four messages render in the in-app notification dropdown / dashboard:

```ts
review_approved:  "Your review of ${address} has been approved and is now live."
review_rejected:  "Your review of ${address} was not approved. See your dashboard for details."
review_disputed:  "Your review of ${address} has been disputed by the landlord."
dispute_resolved: "The dispute on your review of ${address} has been resolved."
```

**Voice assessment:** Already clean. Sentence case ✓. Active voice ✓. No em dashes ✓. No startup vocabulary ✓.

One small note: `review_disputed` says "by the landlord" — this is the only third-party actor referenced. Brand voice is fine with naming the actor explicitly here (it's accurate and useful information). No change recommended.

If CG2 above gets actioned (email reviewers on approve/reject), these strings can be reused as the email body — they're already in voice.

---

## Recommended priority order for fixes

If only a subset get done in the next pass:

1. **🚩 E1 factual error** (verified-badge claim is wrong). User-facing misinformation about what they're being asked to do. Highest priority regardless of voice.
2. **V7 reply-pathway contradiction** in E4 — actively misleads users about whether they can reply.
3. **E3 + E6 (dispute emails)** — these go to landlords, who are the most adversarial recipients of any email surface. Voice drift here reads as either weakness ("Dear", "Thank you for helping us…") or evasion ("appropriate action has been taken"). Tightening both is high-leverage.
4. **CG1 dispute outcome coverage gap** — adding emails for dismiss/partially_valid is a small change that fixes a real product hole and lets E3's wording be accurate.
5. **E1, E2, E4 voice cleanup** (V1/V3/V4/V6) — straightforward sentence-case + filler removal.
6. **E5 H2 sentence case** — admin-only, low-priority polish.
7. **CG2/CG3 (reviewer + verification doc emails)** — separate decision about whether to add new email surfaces. Outside the scope of "audit existing surfaces" but flagged for visibility.

---

*No code changes in this commit. Decisions on which templates to update, in what order, are Meredith's.*
