<?php
/**
 * 读取仓库文件内容
 *
 * GET /api/content.php?path=content/docs/introduction.md
 * GET /api/content.php?path=content/docs/introduction.md&ref=main
 *
 * 用于编辑器初始化时获取最新版文件内容。
 */

require_once __DIR__ . '/cors.php';
require_once __DIR__ . '/../github.php';

$path = $_GET['path'] ?? '';
$ref  = $_GET['ref'] ?? GITHUB_BRANCH;

if (!$path) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing path']);
    exit;
}

// 安全检查：防止路径穿越
$normalizedPath = ltrim(str_replace('\\', '/', $path), '/');
if (strpos($normalizedPath, '..') !== false) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid path']);
    exit;
}

try {
    $result = getFileContent($normalizedPath, $ref);
} catch (Exception $e) {
    http_response_code(404);
    echo json_encode(['success' => false, 'error' => 'File not found: ' . $normalizedPath]);
    exit;
}

if (!$result) {
    http_response_code(404);
    echo json_encode(['success' => false, 'error' => 'File not found']);
    exit;
}

echo json_encode([
    'success' => true,
    'path'    => $normalizedPath,
    'content' => $result['content'],
    'sha'     => $result['sha'],
]);
