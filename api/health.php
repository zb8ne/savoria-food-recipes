<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/RecipeRepository.php';

handleCorsPreflight();

$pdo = getPdoConnection();
$count = (int) $pdo->query('SELECT COUNT(*) FROM recipes')->fetchColumn();

sendJson([
    'status' => 'ok',
    'service' => 'Savoria PHP API',
    'phpVersion' => PHP_VERSION,
    'driver' => getDbDriverName(),
    'recipeCount' => $count,
]);
