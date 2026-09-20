-- =====================================================
-- FITORA GEAR - Database Schema
-- Online Shop for Accessories
-- =====================================================

CREATE DATABASE IF NOT EXISTS fitora_gear;
USE fitora_gear;

-- ---------------------------------------------------
-- Table: admins
-- Mga admin na pwedeng mag-login sa admin panel
-- ---------------------------------------------------
CREATE TABLE admins (
    admin_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL, -- naka-hash gamit ang password_hash()
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------
-- Table: users
-- Mga customer na gagamit ng mobile app
-- ---------------------------------------------------
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    address VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------
-- Table: categories
-- Kategorya ng mga accessories (hal. Watches, Bags, Jewelry)
-- ---------------------------------------------------
CREATE TABLE categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------
-- Table: products
-- Mga accessories na ibinebenta
-- ---------------------------------------------------
CREATE TABLE products (
    product_id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT,
    product_name VARCHAR(150) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    stock INT NOT NULL DEFAULT 0,
    image VARCHAR(255), -- filename ng product image
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE SET NULL
);

-- ---------------------------------------------------
-- Table: orders
-- Order na ginawa ng customer sa mobile app
-- ---------------------------------------------------
CREATE TABLE orders (
    order_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    status ENUM('pending', 'processing', 'shipped', 'completed', 'cancelled') DEFAULT 'pending',
    shipping_address VARCHAR(255),
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ---------------------------------------------------
-- Table: order_items
-- Individual na produkto sa loob ng bawat order
-- ---------------------------------------------------
CREATE TABLE order_items (
    order_item_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(10,2) NOT NULL, -- presyo noong oras ng order
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
);

-- ---------------------------------------------------
-- Sample default admin account
-- Username: admin | Password: admin123
-- (Password na ito ay naka-hash gamit ang PHP password_hash - bcrypt)
-- ---------------------------------------------------
INSERT INTO admins (username, password, full_name, email) VALUES
('admin', '$2y$10$92IXUNpkjO0rOQ5byMi.YeIeM.2Q1JqAI7XdqNQjxrPqxK6WdD2Iy', 'Fitora Admin', 'admin@fitoragear.com');
-- Note: yung hash sa taas ay para sa password na "admin123"

-- ---------------------------------------------------
-- Sample categories
-- ---------------------------------------------------
INSERT INTO categories (category_name, description) VALUES
('Watches', 'Mga wristwatch para sa men at women'),
('Bags', 'Backpacks, sling bags, at handbags'),
('Jewelry', 'Necklace, bracelet, at earrings'),
('Sunglasses', 'Fashion at UV-protected sunglasses');

-- ---------------------------------------------------
-- Sample products
-- ---------------------------------------------------
INSERT INTO products (category_id, product_name, description, price, stock, status) VALUES
(1, 'Classic Leather Watch', 'Elegant na leather strap watch, water resistant', 899.00, 25, 'active'),
(2, 'Canvas Sling Bag', 'Durable canvas bag na may adjustable strap', 450.00, 40, 'active'),
(3, 'Silver Chain Necklace', 'Stainless steel na silver-tone necklace', 320.00, 15, 'active'),
(4, 'Classic Aviator Sunglasses', 'UV400 protection, metal frame', 550.00, 30, 'active');
