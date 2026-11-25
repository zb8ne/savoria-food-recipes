<?php
declare(strict_types=1);

/**
 * PDO Data Access Repository for Recipes, Ingredients, Steps, Favorites & Reviews.
 */
final class RecipeRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /**
     * Returns all recipes matching optional filter & sort criteria.
     */
    public function listRecipes(array $filters = [], ?string $clientToken = null): array
    {
        $where = [];
        $params = [];

        if (!empty($filters['category']) && $filters['category'] !== 'All') {
            $where[] = 'r.category = :category';
            $params[':category'] = (string) $filters['category'];
        }

        if (!empty($filters['vegetarian'])) {
            $where[] = 'r.vegetarian = 1';
        }

        if (!empty($filters['under30'])) {
            $where[] = '(r.prep_time + r.cook_time) <= 30';
        }

        if (!empty($filters['saved_only']) && $clientToken !== null) {
            $where[] = 'EXISTS (SELECT 1 FROM saved_favorites sf WHERE sf.recipe_id = r.id AND sf.client_token = :client_token)';
            $params[':client_token'] = $clientToken;
        }

        if (!empty($filters['q'])) {
            $q = '%' . strtolower(trim((string) $filters['q'])) . '%';
            $where[] = '(
                LOWER(r.title) LIKE :q1
                OR LOWER(r.cuisine) LIKE :q2
                OR LOWER(r.description) LIKE :q3
                OR EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = r.id AND LOWER(ri.item) LIKE :q4)
                OR EXISTS (SELECT 1 FROM recipe_tags rt WHERE rt.recipe_id = r.id AND LOWER(rt.tag) LIKE :q5)
            )';
            $params[':q1'] = $q;
            $params[':q2'] = $q;
            $params[':q3'] = $q;
            $params[':q4'] = $q;
            $params[':q5'] = $q;
        }

        $whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $sort = (string) ($filters['sort'] ?? 'featured');
        $orderSql = match ($sort) {
            'rating' => 'ORDER BY r.rating DESC, r.reviews_count DESC',
            'time-asc' => 'ORDER BY (r.prep_time + r.cook_time) ASC',
            'calories-asc' => 'ORDER BY r.calories ASC',
            default => 'ORDER BY r.featured DESC, r.is_custom DESC, r.created_at DESC',
        };

        $stmt = $this->pdo->prepare("SELECT r.* FROM recipes r {$whereSql} {$orderSql}");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        if (!$rows) {
            return [];
        }

        $ids = array_column($rows, 'id');
        $ingredientsMap = $this->fetchRelatedByRecipeIds('recipe_ingredients', $ids, 'sort_order ASC, id ASC');
        $stepsMap = $this->fetchRelatedByRecipeIds('recipe_steps', $ids, 'step_number ASC');
        $tagsMap = $this->fetchRelatedByRecipeIds('recipe_tags', $ids, 'id ASC');
        $reviewsMap = $this->fetchRelatedByRecipeIds('recipe_reviews', $ids, 'id DESC');

        return array_map(
            fn(array $row) => $this->hydrateRecipe(
                $row,
                $ingredientsMap[$row['id']] ?? [],
                $stepsMap[$row['id']] ?? [],
                $tagsMap[$row['id']] ?? [],
                $reviewsMap[$row['id']] ?? []
            ),
            $rows
        );
    }

    public function getRecipeById(string $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM recipes WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }

        $ingredientsMap = $this->fetchRelatedByRecipeIds('recipe_ingredients', [$id], 'sort_order ASC, id ASC');
        $stepsMap = $this->fetchRelatedByRecipeIds('recipe_steps', [$id], 'step_number ASC');
        $tagsMap = $this->fetchRelatedByRecipeIds('recipe_tags', [$id], 'id ASC');
        $reviewsMap = $this->fetchRelatedByRecipeIds('recipe_reviews', [$id], 'id DESC');

        return $this->hydrateRecipe(
            $row,
            $ingredientsMap[$id] ?? [],
            $stepsMap[$id] ?? [],
            $tagsMap[$id] ?? [],
            $reviewsMap[$id] ?? []
        );
    }

    public function insertRecipe(array $data): array
    {
        $id = !empty($data['id'])
            ? preg_replace('/[^a-zA-Z0-9_-]/', '-', (string) $data['id'])
            : 'recipe-' . bin2hex(random_bytes(6));

        $nutrition = is_array($data['nutrition'] ?? null) ? $data['nutrition'] : [];

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare('
                INSERT INTO recipes (
                    id, title, category, cuisine, difficulty, prep_time, cook_time,
                    servings, rating, reviews_count, featured, vegetarian, is_custom,
                    image, accent_color, description, chef_note, calories, protein, carbs, fat
                ) VALUES (
                    :id, :title, :category, :cuisine, :difficulty, :prep_time, :cook_time,
                    :servings, :rating, :reviews_count, :featured, :vegetarian, :is_custom,
                    :image, :accent_color, :description, :chef_note, :calories, :protein, :carbs, :fat
                )
            ');

            $stmt->execute([
                ':id' => $id,
                ':title' => trim((string) $data['title']),
                ':category' => trim((string) ($data['category'] ?? 'Mains')),
                ':cuisine' => trim((string) ($data['cuisine'] ?? 'Home Kitchen')),
                ':difficulty' => trim((string) ($data['difficulty'] ?? 'Easy')),
                ':prep_time' => max(0, (int) ($data['prepTime'] ?? 15)),
                ':cook_time' => max(0, (int) ($data['cookTime'] ?? 20)),
                ':servings' => max(1, (int) ($data['servings'] ?? 4)),
                ':rating' => (float) ($data['rating'] ?? 5.0),
                ':reviews_count' => max(1, (int) ($data['reviews'] ?? 1)),
                ':featured' => !empty($data['featured']) ? 1 : 0,
                ':vegetarian' => !empty($data['vegetarian']) ? 1 : 0,
                ':is_custom' => array_key_exists('isCustom', $data) ? (!empty($data['isCustom']) ? 1 : 0) : 1,
                ':image' => trim((string) ($data['image'] ?? '')),
                ':accent_color' => trim((string) ($data['accentColor'] ?? '#C8522B')),
                ':description' => trim((string) ($data['description'] ?? '')),
                ':chef_note' => isset($data['chefNote']) ? trim((string) $data['chefNote']) : null,
                ':calories' => max(0, (int) ($nutrition['calories'] ?? $data['calories'] ?? 450)),
                ':protein' => trim((string) ($nutrition['protein'] ?? '—')),
                ':carbs' => trim((string) ($nutrition['carbs'] ?? '—')),
                ':fat' => trim((string) ($nutrition['fat'] ?? '—')),
            ]);

            $this->replaceRecipeChildren($id, $data);
            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return $this->getRecipeById($id) ?? [];
    }

    public function updateRecipe(string $id, array $data): ?array
    {
        $existing = $this->getRecipeById($id);
        if ($existing === null) {
            return null;
        }

        $nutrition = is_array($data['nutrition'] ?? null) ? $data['nutrition'] : $existing['nutrition'];

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare('
                UPDATE recipes SET
                    title = :title,
                    category = :category,
                    cuisine = :cuisine,
                    difficulty = :difficulty,
                    prep_time = :prep_time,
                    cook_time = :cook_time,
                    servings = :servings,
                    vegetarian = :vegetarian,
                    image = :image,
                    description = :description,
                    chef_note = :chef_note,
                    calories = :calories,
                    protein = :protein,
                    carbs = :carbs,
                    fat = :fat
                WHERE id = :id
            ');

            $stmt->execute([
                ':id' => $id,
                ':title' => trim((string) ($data['title'] ?? $existing['title'])),
                ':category' => trim((string) ($data['category'] ?? $existing['category'])),
                ':cuisine' => trim((string) ($data['cuisine'] ?? $existing['cuisine'])),
                ':difficulty' => trim((string) ($data['difficulty'] ?? $existing['difficulty'])),
                ':prep_time' => max(0, (int) ($data['prepTime'] ?? $existing['prepTime'])),
                ':cook_time' => max(0, (int) ($data['cookTime'] ?? $existing['cookTime'])),
                ':servings' => max(1, (int) ($data['servings'] ?? $existing['servings'])),
                ':vegetarian' => array_key_exists('vegetarian', $data) ? (!empty($data['vegetarian']) ? 1 : 0) : ($existing['vegetarian'] ? 1 : 0),
                ':image' => trim((string) ($data['image'] ?? $existing['image'])),
                ':description' => trim((string) ($data['description'] ?? $existing['description'])),
                ':chef_note' => array_key_exists('chefNote', $data) ? trim((string) $data['chefNote']) : $existing['chefNote'],
                ':calories' => max(0, (int) ($nutrition['calories'] ?? 450)),
                ':protein' => trim((string) ($nutrition['protein'] ?? '—')),
                ':carbs' => trim((string) ($nutrition['carbs'] ?? '—')),
                ':fat' => trim((string) ($nutrition['fat'] ?? '—')),
            ]);

            if (isset($data['ingredients']) || isset($data['steps']) || isset($data['tags'])) {
                $this->pdo->prepare('DELETE FROM recipe_ingredients WHERE recipe_id = :id')->execute([':id' => $id]);
                $this->pdo->prepare('DELETE FROM recipe_steps WHERE recipe_id = :id')->execute([':id' => $id]);
                $this->pdo->prepare('DELETE FROM recipe_tags WHERE recipe_id = :id')->execute([':id' => $id]);
                $this->replaceRecipeChildren($id, [
                    'ingredients' => $data['ingredients'] ?? $existing['ingredients'],
                    'steps' => $data['steps'] ?? $existing['steps'],
                    'tags' => $data['tags'] ?? $existing['tags'],
                ]);
            }

            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return $this->getRecipeById($id);
    }

    public function deleteRecipe(string $id): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM recipes WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->rowCount() > 0;
    }

    public function getFavorites(string $clientToken): array
    {
        $stmt = $this->pdo->prepare('SELECT recipe_id FROM saved_favorites WHERE client_token = :token ORDER BY saved_at DESC');
        $stmt->execute([':token' => $clientToken]);
        return array_column($stmt->fetchAll(), 'recipe_id');
    }

    public function toggleFavorite(string $clientToken, string $recipeId): array
    {
        $existsStmt = $this->pdo->prepare('SELECT 1 FROM recipes WHERE id = :id');
        $existsStmt->execute([':id' => $recipeId]);
        if (!$existsStmt->fetchColumn()) {
            throw new InvalidArgumentException('Recipe not found.');
        }

        $check = $this->pdo->prepare('SELECT 1 FROM saved_favorites WHERE client_token = :token AND recipe_id = :id');
        $check->execute([':token' => $clientToken, ':id' => $recipeId]);

        if ($check->fetchColumn()) {
            $del = $this->pdo->prepare('DELETE FROM saved_favorites WHERE client_token = :token AND recipe_id = :id');
            $del->execute([':token' => $clientToken, ':id' => $recipeId]);
            $saved = false;
        } else {
            $ins = $this->pdo->prepare('INSERT INTO saved_favorites (client_token, recipe_id) VALUES (:token, :id)');
            $ins->execute([':token' => $clientToken, ':id' => $recipeId]);
            $saved = true;
        }

        return [
            'recipeId' => $recipeId,
            'saved' => $saved,
            'favorites' => $this->getFavorites($clientToken),
        ];
    }

    public function addReview(string $recipeId, string $authorName, int $stars, string $comment): array
    {
        $recipe = $this->getRecipeById($recipeId);
        if ($recipe === null) {
            throw new InvalidArgumentException('Recipe not found.');
        }

        $clampedStars = max(1, min(5, $stars));
        $trimmedAuthor = trim($authorName);
        $trimmedComment = trim($comment);
        $cleanAuthor = $trimmedAuthor !== ''
            ? (function_exists('mb_substr') ? mb_substr($trimmedAuthor, 0, 80) : substr($trimmedAuthor, 0, 80))
            : 'Home Cook';
        $cleanComment = function_exists('mb_substr') ? mb_substr($trimmedComment, 0, 800) : substr($trimmedComment, 0, 800);

        $this->pdo->beginTransaction();
        try {
            $ins = $this->pdo->prepare('
                INSERT INTO recipe_reviews (recipe_id, author_name, stars, comment)
                VALUES (:recipe_id, :author_name, :stars, :comment)
            ');
            $ins->execute([
                ':recipe_id' => $recipeId,
                ':author_name' => $cleanAuthor,
                ':stars' => $clampedStars,
                ':comment' => $cleanComment,
            ]);

            $prevTotal = ((float) $recipe['rating']) * ((int) $recipe['reviews']);
            $newCount = ((int) $recipe['reviews']) + 1;
            $newAvg = round(($prevTotal + $clampedStars) / $newCount, 2);

            $upd = $this->pdo->prepare('UPDATE recipes SET rating = :rating, reviews_count = :cnt WHERE id = :id');
            $upd->execute([
                ':rating' => $newAvg,
                ':cnt' => $newCount,
                ':id' => $recipeId,
            ]);

            $this->pdo->commit();
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return $this->getRecipeById($recipeId) ?? [];
    }

    private function replaceRecipeChildren(string $recipeId, array $data): void
    {
        $ingStmt = $this->pdo->prepare('
            INSERT INTO recipe_ingredients (recipe_id, sort_order, amount, unit, item)
            VALUES (:recipe_id, :sort_order, :amount, :unit, :item)
        ');
        foreach (($data['ingredients'] ?? []) as $idx => $ing) {
            $amount = isset($ing['amount']) && $ing['amount'] !== '' && $ing['amount'] !== null
                ? (float) $ing['amount']
                : null;
            $ingStmt->execute([
                ':recipe_id' => $recipeId,
                ':sort_order' => $idx,
                ':amount' => $amount,
                ':unit' => trim((string) ($ing['unit'] ?? '')),
                ':item' => trim((string) ($ing['item'] ?? '')),
            ]);
        }

        $stepStmt = $this->pdo->prepare('
            INSERT INTO recipe_steps (recipe_id, step_number, title, instruction, timer_minutes, tip)
            VALUES (:recipe_id, :step_number, :title, :instruction, :timer_minutes, :tip)
        ');
        foreach (($data['steps'] ?? []) as $idx => $step) {
            $stepNumber = $idx + 1;
            $timer = isset($step['timerMinutes']) && (int) $step['timerMinutes'] > 0
                ? (int) $step['timerMinutes']
                : null;
            $stepStmt->execute([
                ':recipe_id' => $recipeId,
                ':step_number' => $stepNumber,
                ':title' => trim((string) ($step['title'] ?? "Step {$stepNumber}")),
                ':instruction' => trim((string) ($step['instruction'] ?? '')),
                ':timer_minutes' => $timer,
                ':tip' => !empty($step['tip']) ? trim((string) $step['tip']) : null,
            ]);
        }

        $tagStmt = $this->pdo->prepare('
            INSERT INTO recipe_tags (recipe_id, tag)
            VALUES (:recipe_id, :tag)
        ');
        foreach (($data['tags'] ?? []) as $tag) {
            $cleanTag = trim((string) $tag);
            if ($cleanTag !== '') {
                $tagStmt->execute([
                    ':recipe_id' => $recipeId,
                    ':tag' => $cleanTag,
                ]);
            }
        }
    }

    private function fetchRelatedByRecipeIds(string $table, array $ids, string $orderBy): array
    {
        if (empty($ids)) {
            return [];
        }
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $this->pdo->prepare("SELECT * FROM {$table} WHERE recipe_id IN ({$placeholders}) ORDER BY {$orderBy}");
        $stmt->execute(array_values($ids));

        $grouped = [];
        foreach ($stmt->fetchAll() as $row) {
            $grouped[$row['recipe_id']][] = $row;
        }
        return $grouped;
    }

    private function hydrateRecipe(array $row, array $ings, array $steps, array $tags, array $reviews): array
    {
        return [
            'id' => (string) $row['id'],
            'title' => (string) $row['title'],
            'category' => (string) $row['category'],
            'cuisine' => (string) $row['cuisine'],
            'difficulty' => (string) $row['difficulty'],
            'prepTime' => (int) $row['prep_time'],
            'cookTime' => (int) $row['cook_time'],
            'servings' => (int) $row['servings'],
            'rating' => round((float) $row['rating'], 1),
            'reviews' => (int) $row['reviews_count'],
            'featured' => (bool) $row['featured'],
            'vegetarian' => (bool) $row['vegetarian'],
            'isCustom' => (bool) $row['is_custom'],
            'tags' => array_map(fn(array $t) => (string) $t['tag'], $tags),
            'image' => (string) ($row['image'] ?? ''),
            'accentColor' => (string) ($row['accent_color'] ?? '#C8522B'),
            'description' => (string) $row['description'],
            'chefNote' => $row['chef_note'] !== null ? (string) $row['chef_note'] : null,
            'nutrition' => [
                'calories' => (int) $row['calories'],
                'protein' => (string) $row['protein'],
                'carbs' => (string) $row['carbs'],
                'fat' => (string) $row['fat'],
            ],
            'ingredients' => array_map(fn(array $i) => [
                'amount' => $i['amount'] !== null ? (float) $i['amount'] : null,
                'unit' => (string) $i['unit'],
                'item' => (string) $i['item'],
            ], $ings),
            'steps' => array_map(fn(array $s) => [
                'title' => (string) $s['title'],
                'instruction' => (string) $s['instruction'],
                'timerMinutes' => $s['timer_minutes'] !== null ? (int) $s['timer_minutes'] : null,
                'tip' => $s['tip'] !== null ? (string) $s['tip'] : null,
            ], $steps),
            'recentReviews' => array_map(fn(array $rev) => [
                'id' => (int) $rev['id'],
                'authorName' => (string) $rev['author_name'],
                'stars' => (int) $rev['stars'],
                'comment' => (string) $rev['comment'],
                'createdAt' => (string) $rev['created_at'],
            ], array_slice($reviews, 0, 10)),
        ];
    }
}
