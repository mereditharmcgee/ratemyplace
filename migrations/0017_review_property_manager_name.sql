-- Migration: Add property_manager_name to reviews
-- Allows tenants to specify a separate property manager if different from landlord
-- NOTE: Column already exists from migration 0004_survey_scores.sql — this is a no-op

SELECT 1;
