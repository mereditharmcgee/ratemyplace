-- RateMyPlace Database Schema
-- Initial migration

-- Landlords table
CREATE TABLE IF NOT EXISTS landlords (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    website TEXT,
    phone TEXT,
    email TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_landlords_slug ON landlords(slug);
CREATE INDEX idx_landlords_name ON landlords(name);

-- Buildings table
CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY,
    landlord_id TEXT REFERENCES landlords(id),
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
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_buildings_slug ON buildings(slug);
CREATE INDEX idx_buildings_landlord ON buildings(landlord_id);
CREATE INDEX idx_buildings_neighborhood ON buildings(neighborhood);
CREATE INDEX idx_buildings_address ON buildings(address);

-- Users table (for Lucia Auth)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    hashed_password TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_users_email ON users(email);

-- Sessions table (for Lucia Auth)
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,

    -- Tenancy details (fuzzy dates for privacy)
    move_in_year INTEGER NOT NULL,
    move_in_season TEXT NOT NULL CHECK (move_in_season IN ('winter', 'spring', 'summer', 'fall')),
    move_out_year INTEGER,
    move_out_season TEXT CHECK (move_out_season IN ('winter', 'spring', 'summer', 'fall')),
    is_current_tenant INTEGER NOT NULL DEFAULT 0,

    -- Unit details
    unit_type TEXT NOT NULL CHECK (unit_type IN ('studio', '1br', '2br', '3br', '4br+', 'house')),
    rent_amount INTEGER,

    -- Category scores (1-5 scale)
    score_building_quality INTEGER CHECK (score_building_quality BETWEEN 1 AND 5),
    score_maintenance INTEGER CHECK (score_maintenance BETWEEN 1 AND 5),
    score_pest_control INTEGER CHECK (score_pest_control BETWEEN 1 AND 5),
    score_safety INTEGER CHECK (score_safety BETWEEN 1 AND 5),
    score_noise INTEGER CHECK (score_noise BETWEEN 1 AND 5),
    score_landlord_responsiveness INTEGER CHECK (score_landlord_responsiveness BETWEEN 1 AND 5),
    score_landlord_communication INTEGER CHECK (score_landlord_communication BETWEEN 1 AND 5),
    score_landlord_fairness INTEGER CHECK (score_landlord_fairness BETWEEN 1 AND 5),
    score_lease_clarity INTEGER CHECK (score_lease_clarity BETWEEN 1 AND 5),
    score_deposit_handling INTEGER CHECK (score_deposit_handling BETWEEN 1 AND 5),
    score_rent_value INTEGER CHECK (score_rent_value BETWEEN 1 AND 5),
    score_amenities INTEGER CHECK (score_amenities BETWEEN 1 AND 5),

    -- Overall rating (calculated)
    overall_score REAL,

    -- Written review
    review_title TEXT,
    review_text TEXT,

    -- Specific issues (boolean flags)
    had_pest_issues INTEGER NOT NULL DEFAULT 0,
    had_heat_issues INTEGER NOT NULL DEFAULT 0,
    had_water_issues INTEGER NOT NULL DEFAULT 0,
    had_security_deposit_issues INTEGER NOT NULL DEFAULT 0,
    had_eviction_threat INTEGER NOT NULL DEFAULT 0,
    would_recommend INTEGER NOT NULL DEFAULT 1,

    -- Moderation
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'flagged')),
    moderation_notes TEXT,

    -- Timestamps
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_reviews_building ON reviews(building_id);
CREATE INDEX idx_reviews_user ON reviews(user_id);
CREATE INDEX idx_reviews_status ON reviews(status);
CREATE INDEX idx_reviews_created ON reviews(created_at);

-- Review helpful votes
CREATE TABLE IF NOT EXISTS review_votes (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vote_type TEXT NOT NULL CHECK (vote_type IN ('helpful', 'not_helpful')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(review_id, user_id)
);

CREATE INDEX idx_review_votes_review ON review_votes(review_id);

-- Building aggregated scores (materialized view alternative)
CREATE TABLE IF NOT EXISTS building_scores (
    building_id TEXT PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
    review_count INTEGER NOT NULL DEFAULT 0,
    avg_overall REAL,
    avg_building_quality REAL,
    avg_maintenance REAL,
    avg_pest_control REAL,
    avg_safety REAL,
    avg_noise REAL,
    avg_landlord_responsiveness REAL,
    avg_landlord_communication REAL,
    avg_landlord_fairness REAL,
    avg_lease_clarity REAL,
    avg_deposit_handling REAL,
    avg_rent_value REAL,
    avg_amenities REAL,
    pct_would_recommend REAL,
    pct_pest_issues REAL,
    pct_heat_issues REAL,
    pct_water_issues REAL,
    pct_deposit_issues REAL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Landlord aggregated scores
CREATE TABLE IF NOT EXISTS landlord_scores (
    landlord_id TEXT PRIMARY KEY REFERENCES landlords(id) ON DELETE CASCADE,
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
