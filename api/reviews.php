<?php
declare(strict_types=1);

/**
 * RESTful Recipe Reviews Endpoint:
 *   GET  /api/reviews.php?recipeId=<slug> -> list recent reviews for a recipe
 *   POST /api/reviews.php                 -> submit `{ "recipeId", "authorName", "stars", "comment" }`
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/RecipeRepository.php';

handleCorsPreflight();

$pdo = getPdoConnection();
$repo = new RecipeRepository($pdo);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($method === 'GET') {
        $recipeId = trim((string) ($_GET['recipeId'] ?? ''));
        if ($recipeId === '') {
            sendJson(['error' => 'recipeId query parameter is required.'], 400);
        }
        $recipe = $repo->getRecipeById($recipeId);
        if ($recipe === null) {
            sendJson(['error' => 'Recipe not found.'], 404);
        }
        sendJson([
            'recipeId' => $recipeId,
            'rating' => $recipe['rating'],
            'reviewsCount' => $recipe['reviews'],
            'reviews' => $recipe['recentReviews'] ?? [],
        ]);
    }

    if ($method === 'POST') {
        $body = readJsonBody();
        $recipeId = trim((string) ($body['recipeId'] ?? ''));
        $authorName = trim((string) ($body['authorName'] ?? 'Home Cook'));
        $stars = (int) ($body['stars'] ?? 5);
        $comment = trim((string) ($body['comment'] ?? ''));

        if ($recipeId === '' || $comment === '') {
            sendJson(['error' => 'recipeId and comment are required.'], 422);
        }
        if ($stars < 1 || $stars > 5) {
            sendJson(['error' => 'Rating stars must be between 1 and 5.'], 422);
        }

        $updatedRecipe = $repo->addReview($recipeId, $authorName, $stars, $comment);
        sendJson([
            'message' => 'Thank you for your review!',
            'recipe' => $updatedRecipe,
        ], 201);
    }

    sendJson(['error' => 'Method not allowed.'], 405);
} catch (InvalidArgumentException $e) {
    sendJson(['error' => $e->getMessage()], 404);
} catch (Throwable $e) {
    sendJson(['error' => 'Failed to save review.', 'details' => $e->getMessage()], 500);
}
