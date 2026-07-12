-- Idempotent backfill of canonical columns from legacy ones, for any rows that
-- predate the *_new columns. Safe to run anytime and to re-run. Old code does
-- not depend on these writes.
UPDATE reviews SET would_recommend_new = CASE would_recommend WHEN 1 THEN 'yes' WHEN 0 THEN 'no' END
  WHERE would_recommend_new IS NULL;
UPDATE reviews SET move_out_year_new = CAST(move_out_year AS TEXT)
  WHERE move_out_year_new IS NULL AND move_out_year IS NOT NULL;
