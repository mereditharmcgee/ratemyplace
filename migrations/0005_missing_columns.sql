-- Migration: Add missing columns that weren't in previous migration

-- Laundry costs
ALTER TABLE reviews ADD COLUMN laundry_wash_cost TEXT;
ALTER TABLE reviews ADD COLUMN laundry_dry_cost TEXT;

-- Pest info
ALTER TABLE reviews ADD COLUMN had_pests INTEGER DEFAULT 0;
ALTER TABLE reviews ADD COLUMN pest_types_experienced TEXT;

-- Moderation tracking
ALTER TABLE reviews ADD COLUMN moderated_at TEXT;
ALTER TABLE reviews ADD COLUMN moderated_by TEXT;
ALTER TABLE reviews ADD COLUMN rejection_reason TEXT;

-- Admin role for users
ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;
