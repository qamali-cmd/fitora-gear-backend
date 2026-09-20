-- =====================================================
-- MIGRATION: Add 26 more products + Tech Accessories category
-- (kasama ang 4 sample products na nasa schema.sql, magiging 30 total)
-- I-run mo ito sa MySQL Workbench.
-- =====================================================

-- USE fitora_gear;

-- Bagong category
INSERT INTO categories (category_name, description) VALUES
('Tech Accessories', 'Everyday tech gear - phone cases, chargers, at iba pa');

-- ---------------------------------------------------
-- WATCHES (5 dagdag, meron nang 1 sa schema.sql)
-- ---------------------------------------------------
INSERT INTO products (category_id, product_name, description, price, stock, status) VALUES
((SELECT category_id FROM categories WHERE category_name = 'Watches'), 'Minimalist Mesh Band Watch', 'Slim na watch na may breathable mesh strap, bagay sa everyday wear', 750.00, 30, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Watches'), 'Rose Gold Dress Watch', 'Elegant na rose gold-tone watch, perfect para sa mga formal occasions', 950.00, 20, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Watches'), 'Digital Sport Watch', 'Water-resistant digital watch na may stopwatch at backlight feature', 680.00, 35, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Watches'), 'Chronograph Steel Watch', 'Stainless steel chronograph watch na may premium na finish', 1200.00, 15, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Watches'), 'Vegan Leather Strap Watch', 'Eco-friendly na watch na may vegan leather strap', 820.00, 25, 'active');

-- ---------------------------------------------------
-- BAGS (5 dagdag, meron nang 1 sa schema.sql)
-- ---------------------------------------------------
INSERT INTO products (category_id, product_name, description, price, stock, status) VALUES
((SELECT category_id FROM categories WHERE category_name = 'Bags'), 'Mini Crossbody Bag', 'Compact na crossbody bag, sapat para sa phone, wallet, at essentials', 520.00, 30, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Bags'), 'Laptop Backpack 15"', 'Padded backpack na may dedicated laptop compartment hanggang 15 inch', 890.00, 20, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Bags'), 'Canvas Tote Bag', 'Simple at spacious na tote bag, bagay sa school o everyday errands', 380.00, 40, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Bags'), 'Waist Fanny Pack', 'Hands-free bag na bagay sa travel at outdoor activities', 310.00, 35, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Bags'), 'Drawstring Gym Bag', 'Lightweight drawstring bag para sa gym essentials', 350.00, 30, 'active');

-- ---------------------------------------------------
-- JEWELRY (5 dagdag, meron nang 1 sa schema.sql)
-- ---------------------------------------------------
INSERT INTO products (category_id, product_name, description, price, stock, status) VALUES
((SELECT category_id FROM categories WHERE category_name = 'Jewelry'), 'Layered Pendant Necklace', 'Double-layer necklace na may simpleng pendant, versatile sa outfit', 280.00, 40, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Jewelry'), 'Minimalist Hoop Earrings', 'Everyday hoop earrings na gawa sa hypoallergenic material', 220.00, 45, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Jewelry'), 'Beaded Charm Bracelet', 'Colorful na beaded bracelet na may small charm accent', 250.00, 35, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Jewelry'), 'Stainless Steel Ring Set (3pcs)', 'Stackable ring set, tibay at hindi nangingitim', 300.00, 30, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Jewelry'), 'Pearl Stud Earrings', 'Classic pearl stud earrings, bagay sa casual at formal look', 260.00, 30, 'active');

-- ---------------------------------------------------
-- SUNGLASSES (5 dagdag, meron nang 1 sa schema.sql)
-- ---------------------------------------------------
INSERT INTO products (category_id, product_name, description, price, stock, status) VALUES
((SELECT category_id FROM categories WHERE category_name = 'Sunglasses'), 'Retro Round Sunglasses', 'Vintage-inspired round frame na may UV400 protection', 480.00, 30, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Sunglasses'), 'Polarized Sport Sunglasses', 'Lightweight sunglasses na bagay sa outdoor sports at biking', 600.00, 25, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Sunglasses'), 'Cat-Eye Sunglasses', 'Fashion-forward cat-eye frame na may gradient lens', 520.00, 25, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Sunglasses'), 'Clear Lens Blue-Light Glasses', 'Everyday glasses na may blue-light filtering para sa screen time', 450.00, 40, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Sunglasses'), 'Oversized Square Sunglasses', 'Bold oversized frame na trending ngayon', 540.00, 20, 'active');

-- ---------------------------------------------------
-- TECH ACCESSORIES (6 bago, walang existing)
-- ---------------------------------------------------
INSERT INTO products (category_id, product_name, description, price, stock, status) VALUES
((SELECT category_id FROM categories WHERE category_name = 'Tech Accessories'), 'Silicone Phone Case (Universal Fit)', 'Shockproof silicone case na available sa iba''t ibang kulay', 250.00, 50, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Tech Accessories'), 'Wireless Earbud Case Cover', 'Protective silicone cover para sa wireless earbuds', 180.00, 45, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Tech Accessories'), 'Braided USB-C Charging Cable', 'Durable na braided cable, 1.5 meters ang haba', 220.00, 50, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Tech Accessories'), 'MagSafe-Compatible Card Holder', 'Magnetic card holder na kadikit sa likod ng phone', 350.00, 30, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Tech Accessories'), 'Portable Power Bank 10000mAh', 'Compact power bank, sapat magcharge ng 2x sa karaniwang phone', 750.00, 25, 'active'),
((SELECT category_id FROM categories WHERE category_name = 'Tech Accessories'), 'Foldable Phone Stand', 'Adjustable at foldable stand, bagay sa video calls at streaming', 200.00, 40, 'active');
