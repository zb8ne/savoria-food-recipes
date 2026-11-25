-- ============================================================================
-- Savoria Food Recipe Website — Relational Database Schema (MySQL / MariaDB)
-- Import into phpMyAdmin / MySQL if using DB_DRIVER=mysql, or let api/config.php
-- auto-initialize SQLite out of the box!
-- ============================================================================

CREATE DATABASE IF NOT EXISTS savoria_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE savoria_db;

CREATE TABLE IF NOT EXISTS recipes (
  id VARCHAR(96) PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  category VARCHAR(64) NOT NULL,
  cuisine VARCHAR(80) NOT NULL,
  difficulty VARCHAR(32) NOT NULL DEFAULT 'Easy',
  prep_time INT NOT NULL DEFAULT 15,
  cook_time INT NOT NULL DEFAULT 20,
  servings INT NOT NULL DEFAULT 4,
  rating DECIMAL(3,2) NOT NULL DEFAULT 5.00,
  reviews_count INT NOT NULL DEFAULT 1,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  vegetarian TINYINT(1) NOT NULL DEFAULT 0,
  is_custom TINYINT(1) NOT NULL DEFAULT 0,
  image VARCHAR(512) DEFAULT '',
  accent_color VARCHAR(16) DEFAULT '#C8522B',
  description TEXT NOT NULL,
  chef_note TEXT DEFAULT NULL,
  calories INT NOT NULL DEFAULT 450,
  protein VARCHAR(24) NOT NULL DEFAULT '—',
  carbs VARCHAR(24) NOT NULL DEFAULT '—',
  fat VARCHAR(24) NOT NULL DEFAULT '—',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipe_id VARCHAR(96) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  amount DECIMAL(8,3) NULL,
  unit VARCHAR(40) DEFAULT '',
  item VARCHAR(255) NOT NULL,
  CONSTRAINT fk_ing_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS recipe_steps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipe_id VARCHAR(96) NOT NULL,
  step_number INT NOT NULL,
  title VARCHAR(160) NOT NULL,
  instruction TEXT NOT NULL,
  timer_minutes INT NULL,
  tip TEXT NULL,
  CONSTRAINT fk_step_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS recipe_tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipe_id VARCHAR(96) NOT NULL,
  tag VARCHAR(64) NOT NULL,
  CONSTRAINT fk_tag_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS saved_favorites (
  client_token VARCHAR(96) NOT NULL,
  recipe_id VARCHAR(96) NOT NULL,
  saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_token, recipe_id),
  CONSTRAINT fk_fav_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS recipe_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipe_id VARCHAR(96) NOT NULL,
  author_name VARCHAR(80) NOT NULL,
  stars TINYINT NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rev_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
