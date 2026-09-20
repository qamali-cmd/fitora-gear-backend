-- =====================================================
-- MIGRATION: Add stock_logs table
-- I-run mo ito sa MySQL Workbench kung meron ka nang
-- existing na fitora_gear database (hindi mo na kailangang
-- i-rerun ang buong schema.sql)
-- =====================================================

-- USE fitora_gear;

CREATE TABLE IF NOT EXISTS stock_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    change_amount INT NOT NULL,
    reason VARCHAR(100) NOT NULL,
    admin_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (admin_id) REFERENCES admins(admin_id) ON DELETE SET NULL
);
