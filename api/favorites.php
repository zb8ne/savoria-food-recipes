<?php
declare(strict_types=1);

/**
 * RESTful Saved Favorites Endpoint:
 *   GET  /api/favorites.php -> returns saved recipe IDs for current session/client token
 *   POST /api/favorites.php -> toggles saved state for `{ "recipeId": "..." }`
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/RecipeRepository.php';

handleCorsPreflight();

$pdo = getPdoConnection();
$repo = new RecipeRepository($pdo);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$clientToken = getClientToken();

try {
    if ($method === 'GET') {
        sendJson([
            'favorites' => $repo->getFavorites($clientToken),
        ]);
    }

    if ($method === 'POST') {
        $body = readJsonBody();
        $recipeId = trim((string) ($body['recipeId'] ?? ''));
        if ($recipeId === '') {
            sendJson(['error' => 'recipeId is required.'], 422);
        }
        $result = $repo->toggleFavorite($clientToken, $recipeId);
        sendJson($result);
    }

    sendJson(['error' => 'Method not allowed.'], 405);
} catch (InvalidArgumentException $e) {
    sendJson(['error' => $e->getMessage()], 404);
} catch (Throwable $e) {
    sendJson(['error' => 'Unable to update saved recipes.', 'details' => $e->getMessage()], 500);
}
