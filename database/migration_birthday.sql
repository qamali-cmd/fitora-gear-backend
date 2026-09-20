-- =====================================================
-- MIGRATION: Add birthday column sa users table
-- I-run mo ito sa MySQL Workbench.
-- =====================================================

-- USE fitora_gear;

ALTER TABLE users
ADD COLUMN birthday DATE NULL;
