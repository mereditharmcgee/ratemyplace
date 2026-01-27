-- Add admin notes and info fields to buildings and landlords
-- Migration 0009

-- Admin notes for buildings (internal use)
ALTER TABLE buildings ADD COLUMN admin_notes TEXT;

-- Additional info that can be displayed publicly
ALTER TABLE buildings ADD COLUMN public_info TEXT; -- JSON object with structured info

-- Ownership/management info
ALTER TABLE buildings ADD COLUMN owner_name TEXT;
ALTER TABLE buildings ADD COLUMN owner_entity TEXT; -- LLC, trust, individual, etc.
ALTER TABLE buildings ADD COLUMN owner_website TEXT;

-- Same for landlords
ALTER TABLE landlords ADD COLUMN admin_notes TEXT;
ALTER TABLE landlords ADD COLUMN owner_entity TEXT;
ALTER TABLE landlords ADD COLUMN total_units INTEGER;
ALTER TABLE landlords ADD COLUMN verified INTEGER DEFAULT 0;

-- Same for property managers
ALTER TABLE property_managers ADD COLUMN admin_notes TEXT;
ALTER TABLE property_managers ADD COLUMN total_units INTEGER;
ALTER TABLE property_managers ADD COLUMN verified INTEGER DEFAULT 0;
