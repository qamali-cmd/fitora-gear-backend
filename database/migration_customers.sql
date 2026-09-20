-- =====================================================
-- MIGRATION: Add is_active column sa users table
-- Ginagamit para sa Customer Management (activate/deactivate account)
-- I-run mo ito sa MySQL Workbench.
-- =====================================================

-- USE fitora_gear;

ALTER TABLE users
ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;
