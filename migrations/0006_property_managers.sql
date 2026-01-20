-- Migration: Add property managers system
-- Buildings can have BOTH a landlord (owner) AND a property manager

-- Property managers table
CREATE TABLE IF NOT EXISTS property_managers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    company_name TEXT,
    description TEXT,
    website TEXT,
    phone TEXT,
    email TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_property_managers_slug ON property_managers(slug);
CREATE INDEX IF NOT EXISTS idx_property_managers_name ON property_managers(name);

-- Property manager aggregated scores
CREATE TABLE IF NOT EXISTS property_manager_scores (
    property_manager_id TEXT PRIMARY KEY REFERENCES property_managers(id) ON DELETE CASCADE,
    building_count INTEGER NOT NULL DEFAULT 0,
    review_count INTEGER NOT NULL DEFAULT 0,
    avg_overall REAL,
    avg_landlord_responsiveness REAL,
    avg_landlord_communication REAL,
    avg_landlord_fairness REAL,
    avg_lease_clarity REAL,
    avg_deposit_handling REAL,
    pct_would_recommend REAL,
    pct_deposit_issues REAL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Link buildings to property managers (in addition to existing landlord_id)
ALTER TABLE buildings ADD COLUMN property_manager_id TEXT REFERENCES property_managers(id);
