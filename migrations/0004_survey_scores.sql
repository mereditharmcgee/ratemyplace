-- Migration: Add new survey-based scoring columns
-- Based on OHQS/PHQS research - 27 items across three domains

-- Unit scores (10 items)
ALTER TABLE reviews ADD COLUMN unit_structural INTEGER CHECK (unit_structural BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN unit_plumbing INTEGER CHECK (unit_plumbing BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN unit_electrical INTEGER CHECK (unit_electrical BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN unit_climate INTEGER CHECK (unit_climate BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN unit_ventilation INTEGER CHECK (unit_ventilation BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN unit_pests INTEGER CHECK (unit_pests BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN unit_mold INTEGER CHECK (unit_mold BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN unit_appliances INTEGER CHECK (unit_appliances BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN unit_layout INTEGER CHECK (unit_layout BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN unit_accuracy INTEGER CHECK (unit_accuracy BETWEEN 1 AND 5);

-- Building scores (9 items)
ALTER TABLE reviews ADD COLUMN building_common_areas INTEGER CHECK (building_common_areas BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN building_security INTEGER CHECK (building_security BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN building_exterior INTEGER CHECK (building_exterior BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN building_noise_neighbors INTEGER CHECK (building_noise_neighbors BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN building_noise_external INTEGER CHECK (building_noise_external BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN building_mail INTEGER CHECK (building_mail BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN building_laundry INTEGER CHECK (building_laundry BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN building_parking INTEGER CHECK (building_parking BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN building_trash INTEGER CHECK (building_trash BETWEEN 1 AND 5);

-- Landlord scores (8 items)
ALTER TABLE reviews ADD COLUMN landlord_maintenance INTEGER CHECK (landlord_maintenance BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN landlord_communication INTEGER CHECK (landlord_communication BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN landlord_professionalism INTEGER CHECK (landlord_professionalism BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN landlord_lease_clarity INTEGER CHECK (landlord_lease_clarity BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN landlord_privacy INTEGER CHECK (landlord_privacy BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN landlord_deposit INTEGER CHECK (landlord_deposit BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN landlord_rent_practices INTEGER CHECK (landlord_rent_practices BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN landlord_non_retaliation INTEGER CHECK (landlord_non_retaliation BETWEEN 1 AND 5);

-- New tenancy/unit fields
ALTER TABLE reviews ADD COLUMN tenure_months INTEGER;
ALTER TABLE reviews ADD COLUMN move_out_year_new TEXT;
ALTER TABLE reviews ADD COLUMN bedrooms TEXT;
ALTER TABLE reviews ADD COLUMN bathrooms TEXT;
ALTER TABLE reviews ADD COLUMN square_footage INTEGER;
ALTER TABLE reviews ADD COLUMN unit_number TEXT;
ALTER TABLE reviews ADD COLUMN amenities TEXT;
ALTER TABLE reviews ADD COLUMN utilities_included TEXT;

-- Landlord info fields
ALTER TABLE reviews ADD COLUMN landlord_name TEXT;
ALTER TABLE reviews ADD COLUMN property_manager_name TEXT;
ALTER TABLE reviews ADD COLUMN has_onsite_manager INTEGER DEFAULT 0;

-- Laundry options
ALTER TABLE reviews ADD COLUMN laundry_type TEXT;
ALTER TABLE reviews ADD COLUMN laundry_wash_cost TEXT;
ALTER TABLE reviews ADD COLUMN laundry_dry_cost TEXT;

-- Parking options
ALTER TABLE reviews ADD COLUMN parking_type TEXT;

-- Pest info
ALTER TABLE reviews ADD COLUMN had_pests INTEGER DEFAULT 0;
ALTER TABLE reviews ADD COLUMN pest_types_experienced TEXT;

-- Pet info
ALTER TABLE reviews ADD COLUMN pet_types TEXT;

-- Comments field
ALTER TABLE reviews ADD COLUMN comments TEXT;

-- Would recommend as text
ALTER TABLE reviews ADD COLUMN would_recommend_new TEXT;

-- Moderation tracking
ALTER TABLE reviews ADD COLUMN moderated_at TEXT;
ALTER TABLE reviews ADD COLUMN moderated_by TEXT;
ALTER TABLE reviews ADD COLUMN rejection_reason TEXT;

-- Admin role for users
ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;
