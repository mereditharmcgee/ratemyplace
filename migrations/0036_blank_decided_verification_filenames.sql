-- Blank the uploaded filename on every proof-of-address row that has been decided.
--
-- A tenant's filename often names their address or unit. Since November 2026 the decision
-- route blanks it when an admin approves or rejects (src/pages/api/admin/verification/[id].ts).
-- This clears the rows decided before that. Pending rows keep their filename, since an admin
-- still needs it. The column is NOT NULL, so blank is ''.
--
-- Idempotent: it binds nothing, and a second run matches no rows.
-- Production: apply once with `wrangler d1 execute --remote --file`, never
-- `migrations apply --remote`. See migrations/AGENTS.md.

UPDATE verification_images
SET filename = ''
WHERE status IN ('approved', 'rejected') AND filename <> '';
