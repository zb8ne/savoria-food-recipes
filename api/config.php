<?php
declare(strict_types=1);

/**
 * Savoria PHP Backend Configuration, PDO Connection & HTTP Helpers.
 *
 * Supports:
 * - Zero-config SQLite out of the box (`storage/savoria.sqlite`)
 * - MySQL / MariaDB via environment variables (`DB_DRIVER=mysql`, `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`)
 */

require_once __DIR__ . '/seed_data.php';

function sendJson(mixed $payload, int $statusCode = 200): never
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Client-Token');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function handleCorsPreflight(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        sendJson(['ok' => true], 200);
    }
}

function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        sendJson(['error' => 'Invalid JSON request body.'], 400);
    }
    return $decoded;
}

function getClientToken(): string
{
    if (session_status() === PHP_SESSION_NONE) {
        @session_start();
    }
    $headerToken = trim((string) ($_SERVER['HTTP_X_CLIENT_TOKEN'] ?? ''));
    if ($headerToken !== '' && preg_match('/^[a-zA-Z0-9_-]{8,90}$/', $headerToken)) {
        return $headerToken;
    }
    if (empty($_SESSION['savoria_client_token'])) {
        $_SESSION['savoria_client_token'] = bin2hex(random_bytes(16));
    }
    return (string) $_SESSION['savoria_client_token'];
}

function getDbDriverName(): string
{
    $envDriver = strtolower(trim((string) (getenv('DB_DRIVER') ?: 'sqlite')));
    return in_array($envDriver, ['mysql', 'sqlite'], true) ? $envDriver : 'sqlite';
}

function getPdoConnection(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $driver = getDbDriverName();

    try {
        if ($driver === 'mysql') {
            $host = getenv('DB_HOST') ?: '127.0.0.1';
            $port = getenv('DB_PORT') ?: '3306';
            $dbName = getenv('DB_NAME') ?: 'savoria_db';
            $user = getenv('DB_USER') ?: 'root';
            $pass = getenv('DB_PASS') !== false ? (string) getenv('DB_PASS') : '';

            $dsn = "mysql:host={$host};port={$port};dbname={$dbName};charset=utf8mb4";
            $pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            initializeMysqlSchema($pdo);
        } else {
            $defaultDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'storage';
            $isVercel = (bool) getenv('VERCEL');
            $storageDir = $isVercel ? sys_get_temp_dir() : $defaultDir;
            if (!is_dir($storageDir) && !@mkdir($storageDir, 0775, true)) {
                $storageDir = sys_get_temp_dir();
            } elseif (!is_writable($storageDir)) {
                $storageDir = sys_get_temp_dir();
            }
            $dbFile = rtrim($storageDir, '/\\') . DIRECTORY_SEPARATOR . 'savoria.sqlite';
            $pdo = new PDO('sqlite:' . $dbFile, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
            $pdo->exec('PRAGMA foreign_keys = ON;');
            $pdo->exec('PRAGMA journal_mode = WAL;');
            initializeSqliteSchema($pdo);
        }

        seedDatabaseIfEmpty($pdo);
        return $pdo;
    } catch (Throwable $e) {
        sendJson([
            'error' => 'Database connection failed.',
            'details' => $e->getMessage(),
        ], 500);
    }
}

function initializeSqliteSchema(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS recipes (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            cuisine TEXT NOT NULL,
            difficulty TEXT NOT NULL DEFAULT 'Easy',
            prep_time INTEGER NOT NULL DEFAULT 15,
            cook_time INTEGER NOT NULL DEFAULT 20,
            servings INTEGER NOT NULL DEFAULT 4,
            rating REAL NOT NULL DEFAULT 5.0,
            reviews_count INTEGER NOT NULL DEFAULT 1,
            featured INTEGER NOT NULL DEFAULT 0,
            vegetarian INTEGER NOT NULL DEFAULT 0,
            is_custom INTEGER NOT NULL DEFAULT 0,
            image TEXT DEFAULT '',
            accent_color TEXT DEFAULT '#C8522B',
            description TEXT NOT NULL,
            chef_note TEXT DEFAULT NULL,
            calories INTEGER NOT NULL DEFAULT 450,
            protein TEXT NOT NULL DEFAULT '—',
            carbs TEXT NOT NULL DEFAULT '—',
            fat TEXT NOT NULL DEFAULT '—',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS recipe_ingredients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            amount REAL NULL,
            unit TEXT DEFAULT '',
            item TEXT NOT NULL,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS recipe_steps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            step_number INTEGER NOT NULL,
            title TEXT NOT NULL,
            instruction TEXT NOT NULL,
            timer_minutes INTEGER NULL,
            tip TEXT NULL,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS recipe_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            tag TEXT NOT NULL,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS saved_favorites (
            client_token TEXT NOT NULL,
            recipe_id TEXT NOT NULL,
            saved_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (client_token, recipe_id),
            FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS recipe_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id TEXT NOT NULL,
            author_name TEXT NOT NULL,
            stars INTEGER NOT NULL,
            comment TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        );
    ");
}

function initializeMysqlSchema(PDO $pdo): void
{
    $pdo->exec("
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
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS recipe_ingredients (
            id INT AUTO_INCREMENT PRIMARY KEY,
            recipe_id VARCHAR(96) NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            amount DECIMAL(8,3) NULL,
            unit VARCHAR(40) DEFAULT '',
            item VARCHAR(255) NOT NULL,
            CONSTRAINT fk_ing_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");
    $pdo->exec("
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
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS recipe_tags (
            id INT AUTO_INCREMENT PRIMARY KEY,
            recipe_id VARCHAR(96) NOT NULL,
            tag VARCHAR(64) NOT NULL,
            CONSTRAINT fk_tag_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS saved_favorites (
            client_token VARCHAR(96) NOT NULL,
            recipe_id VARCHAR(96) NOT NULL,
            saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (client_token, recipe_id),
            CONSTRAINT fk_fav_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS recipe_reviews (
            id INT AUTO_INCREMENT PRIMARY KEY,
            recipe_id VARCHAR(96) NOT NULL,
            author_name VARCHAR(80) NOT NULL,
            stars TINYINT NOT NULL,
            comment TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_rev_recipe FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ");
}

function seedDatabaseIfEmpty(PDO $pdo): void
{
    $count = (int) $pdo->query('SELECT COUNT(*) FROM recipes')->fetchColumn();
    if ($count > 0) {
        return;
    }

    require_once __DIR__ . '/RecipeRepository.php';
    $repo = new RecipeRepository($pdo);
    foreach (getInitialRecipesSeed() as $seedRecipe) {
        $repo->insertRecipe($seedRecipe);
    }
}
