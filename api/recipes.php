<?php
declare(strict_types=1);

/**
 * RESTful Recipes Endpoint:
 *   GET    /api/recipes.php             -> list & filter recipes
 *   GET    /api/recipes.php?id=<slug>   -> get single recipe details
 *   POST   /api/recipes.php             -> create a new recipe
 *   PUT    /api/recipes.php?id=<slug>   -> update an existing recipe
 *   DELETE /api/recipes.php?id=<slug>   -> delete a custom recipe
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/RecipeRepository.php';

handleCorsPreflight();

$pdo = getPdoConnection();
$repo = new RecipeRepository($pdo);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$clientToken = getClientToken();

try {
    switch ($method) {
        case 'GET':
            $id = trim((string) ($_GET['id'] ?? ''));
            if ($id !== '') {
                $recipe = $repo->getRecipeById($id);
                if ($recipe === null) {
                    sendJson(['error' => 'Recipe not found.'], 404);
                }
                sendJson(['recipe' => $recipe]);
            }

            $filters = [
                'q' => $_GET['q'] ?? '',
                'category' => $_GET['category'] ?? 'All',
                'vegetarian' => filter_var($_GET['vegetarian'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'under30' => filter_var($_GET['under30'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'saved_only' => filter_var($_GET['saved_only'] ?? false, FILTER_VALIDATE_BOOLEAN),
                'sort' => $_GET['sort'] ?? 'featured',
            ];

            $recipes = $repo->listRecipes($filters, $clientToken);
            $favorites = $repo->getFavorites($clientToken);

            sendJson([
                'recipes' => $recipes,
                'favorites' => $favorites,
                'total' => count($recipes),
            ]);

        case 'POST':
            $body = readJsonBody();
            $title = trim((string) ($body['title'] ?? ''));
            $description = trim((string) ($body['description'] ?? ''));
            $ingredients = $body['ingredients'] ?? [];
            $steps = $body['steps'] ?? [];

            if ($title === '' || $description === '') {
                sendJson(['error' => 'Recipe title and description are required.'], 422);
            }
            if (!is_array($ingredients) || count($ingredients) === 0) {
                sendJson(['error' => 'At least one ingredient is required.'], 422);
            }
            if (!is_array($steps) || count($steps) === 0) {
                sendJson(['error' => 'At least one cooking instruction step is required.'], 422);
            }

            $body['isCustom'] = true;
            $created = $repo->insertRecipe($body);
            sendJson(['message' => 'Recipe created successfully.', 'recipe' => $created], 201);

        case 'PUT':
            $id = trim((string) ($_GET['id'] ?? ''));
            if ($id === '') {
                sendJson(['error' => 'Missing recipe id parameter.'], 400);
            }
            $body = readJsonBody();
            $updated = $repo->updateRecipe($id, $body);
            if ($updated === null) {
                sendJson(['error' => 'Recipe not found.'], 404);
            }
            sendJson(['message' => 'Recipe updated.', 'recipe' => $updated]);

        case 'DELETE':
            $id = trim((string) ($_GET['id'] ?? ''));
            if ($id === '') {
                sendJson(['error' => 'Missing recipe id parameter.'], 400);
            }
            $existing = $repo->getRecipeById($id);
            if ($existing === null) {
                sendJson(['error' => 'Recipe not found.'], 404);
            }
            if (!$existing['isCustom']) {
                sendJson(['error' => 'Built-in curated recipes cannot be deleted.'], 403);
            }
            $repo->deleteRecipe($id);
            sendJson(['message' => 'Custom recipe deleted.', 'deletedId' => $id]);

        default:
            sendJson(['error' => 'Method not allowed.'], 405);
    }
} catch (InvalidArgumentException $e) {
    sendJson(['error' => $e->getMessage()], 400);
} catch (Throwable $e) {
    sendJson(['error' => 'Server error processing request.', 'details' => $e->getMessage()], 500);
}
