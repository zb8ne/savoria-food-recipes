# Savoria — Responsive Food Recipe Website (HTML, CSS, JS + PHP Backend)

A responsive culinary recipe explorer built with **HTML5**, **CSS3**, **Vanilla JavaScript**, and a **RESTful PHP PDO Backend** supporting both zero-config **SQLite** and **MySQL / MariaDB (XAMPP / WAMP / Docker)**.

## Backend Architecture (`api/` & `database/`)

- **`api/config.php`** — PDO database connection manager, CORS/JSON helpers, client session token handling, and automatic schema creation + initial seeding (`storage/savoria.sqlite` by default, or MySQL via `DB_DRIVER=mysql`).
- **`api/RecipeRepository.php`** — Prepared-statement PDO repository managing `recipes`, `recipe_ingredients`, `recipe_steps`, `recipe_tags`, `saved_favorites`, and `recipe_reviews`.
- **`api/recipes.php`** — `GET` (list/search/filter or fetch single recipe), `POST` (create recipe), `PUT` (update recipe), `DELETE` (delete custom recipe).
- **`api/favorites.php`** — `GET` & `POST` server-persisted favorite recipes per client/session token.
- **`api/reviews.php`** — `GET` & `POST` star ratings and cook notes with automatic rating recalculation.
- **`api/health.php`** — Backend health check, PHP version, active database driver, and recipe count.
- **`database/schema.sql`** — Ready-to-import MySQL / MariaDB relational schema for phpMyAdmin or MySQL CLI.

## Running Locally

### Option 1: Docker (Zero Setup — Recommended if PHP isn't installed locally)
```powershell
cd C:\Users\Yash-HomePC\code\food-recipe-website
docker compose up -d
```
Then open `http://localhost:8095`.

### Option 2: PHP Built-in Server
```powershell
cd C:\Users\Yash-HomePC\code\food-recipe-website
php -S localhost:8080 router.php
```

### Option 3: XAMPP / WAMP / Apache (with MySQL)
1. Copy or symlink this folder into `htdocs/food-recipe-website`.
2. (Optional) Import `database/schema.sql` in phpMyAdmin and set `DB_DRIVER=mysql` (`DB_HOST=127.0.0.1`, `DB_NAME=savoria_db`, `DB_USER=root`, `DB_PASS=`), or leave default to auto-use SQLite!
