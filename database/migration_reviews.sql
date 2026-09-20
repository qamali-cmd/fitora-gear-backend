-- =====================================================
-- MIGRATION: Add reviews table
-- Ginagamit para sa Reviews Management (moderation ng customer reviews)
-- I-run mo ito sa MySQL Workbench.
-- =====================================================

-- USE fitora_gear;

CREATE TABLE IF NOT EXISTS reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    user_id INT NOT NULL,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    status ENUM('pending', 'approved', 'hidden') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Ilang sample reviews para may makita agad tayo habang tinetest
-- (kailangan muna ng kahit isang sample customer sa users table)
INSERT INTO users (full_name, email, password, phone, address) VALUES
('Maria Santos', 'maria.santos@example.com', 'placeholder_hash', '09171234567', 'Quezon City'),
('Jake Reyes', 'jake.reyes@example.com', 'placeholder_hash', '09181234567', 'Makati City');

INSERT INTO reviews (product_id, user_id, rating, comment, status)
SELECT product_id, (SELECT user_id FROM users WHERE email = 'maria.santos@example.com'), 5, 'Ang ganda ng quality, sulit sa price!', 'pending'
FROM products ORDER BY product_id LIMIT 1;

INSERT INTO reviews (product_id, user_id, rating, comment, status)
SELECT product_id, (SELECT user_id FROM users WHERE email = 'jake.reyes@example.com'), 4, 'Maganda pero medyo mabagal ang delivery.', 'pending'
FROM products ORDER BY product_id LIMIT 1 OFFSET 1;
