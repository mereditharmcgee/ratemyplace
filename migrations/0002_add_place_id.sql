-- Add Google Place ID to buildings table for deduplication
-- Migration for v0.3.0-alpha

ALTER TABLE buildings ADD COLUMN google_place_id TEXT;

CREATE UNIQUE INDEX idx_buildings_place_id ON buildings(google_place_id) WHERE google_place_id IS NOT NULL;
