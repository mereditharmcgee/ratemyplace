-- Drop the precomputed score cache tables. They were only ever written by the
-- seed script (never by application code) and are fully recomputable from the
-- reviews table, so dropping them loses no authoritative data. All views now
-- compute scores on read via the shared recency-weighted aggregation.
DROP TABLE IF EXISTS building_scores;
DROP TABLE IF EXISTS landlord_scores;
DROP TABLE IF EXISTS property_manager_scores;
