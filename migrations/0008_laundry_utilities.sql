-- Add laundry cost and estimated utilities fields
-- Migration 0008
-- Note: unit_number, bathrooms, square_footage, amenities, utilities_included already exist from 0004

-- Add laundry cost (for co-op or building laundry) - new field
ALTER TABLE reviews ADD COLUMN laundry_cost_per_load REAL;

-- Add estimated monthly utility cost (for non-included utilities) - new field
ALTER TABLE reviews ADD COLUMN estimated_monthly_utilities INTEGER;
