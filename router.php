<?php
declare(strict_types=1);

/**
 * Router for PHP built-in development server:
 *   php -S localhost:8080 router.php
 */

$uri = urldecode((string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));

// Block direct HTTP access to SQLite storage or raw SQL schema files
if (preg_match('#^/(storage|database)(/|$)#', $uri)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Forbidden']);
    return true;
}

$filePath = __DIR__ . $uri;
if ($uri !== '/' && is_file($filePath)) {
    return false; // Let PHP serve static assets & api/*.php directly
}

// Default SPA / index fallback
require __DIR__ . '/index.html';
return true;
