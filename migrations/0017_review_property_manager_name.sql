-- Migration: Add property_manager_name to reviews
-- Allows tenants to specify a separate property manager if different from landlord

ALTER TABLE reviews ADD COLUMN property_manager_name TEXT;
