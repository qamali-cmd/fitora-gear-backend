-- =====================================================
-- MIGRATION: Role-Based Access Control (RBAC)
-- Nagdadagdag ng "role" (super_admin/staff) at "permissions"
-- (kung anong mga tabs lang ang pwedeng buksan ng isang staff admin)
-- I-run mo ito sa MySQL Workbench.
-- =====================================================

-- USE fitora_gear;

ALTER TABLE admins
ADD COLUMN role ENUM('super_admin', 'staff') NOT NULL DEFAULT 'staff',
ADD COLUMN permissions VARCHAR(255) DEFAULT NULL;

-- Gawing Super Admin ang existing default admin account mo
-- (dahil siya yung nag-set up ng buong system, dapat buong access siya)
UPDATE admins SET role = 'super_admin' WHERE username = 'admin';
