-- Drop the 15 legacy/dead columns now that all code reads/writes the canonical
-- columns. No index or table-level CHECK references these, so no table rebuild
-- is needed. Apply to prod ONLY AFTER the code that stopped using them is deployed.
ALTER TABLE reviews DROP COLUMN had_pests;
ALTER TABLE reviews DROP COLUMN score_building_quality;
ALTER TABLE reviews DROP COLUMN score_maintenance;
ALTER TABLE reviews DROP COLUMN score_pest_control;
ALTER TABLE reviews DROP COLUMN score_safety;
ALTER TABLE reviews DROP COLUMN score_noise;
ALTER TABLE reviews DROP COLUMN score_landlord_responsiveness;
ALTER TABLE reviews DROP COLUMN score_landlord_communication;
ALTER TABLE reviews DROP COLUMN score_landlord_fairness;
ALTER TABLE reviews DROP COLUMN score_lease_clarity;
ALTER TABLE reviews DROP COLUMN score_deposit_handling;
ALTER TABLE reviews DROP COLUMN score_rent_value;
ALTER TABLE reviews DROP COLUMN score_amenities;
ALTER TABLE reviews DROP COLUMN would_recommend;
ALTER TABLE reviews DROP COLUMN move_out_year;
