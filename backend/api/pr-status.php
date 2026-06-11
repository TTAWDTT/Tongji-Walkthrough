<?php
/**
 * 查询 PR 状态
 *
 * GET /api/pr-status.php?pr_number=42
 *
 * 从 GitHub API 获取最新状态，并同步到本地数据库。
 */

require_once __DIR__ . '/cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../github.php';

$prNumber = isset($_GET['pr_number']) ? (int)$_GET['pr_number'] : 0;
if ($prNumber <= 0) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid pr_number']);
    exit;
}

// 查找本地记录
$mapping = findPRByNumber($prNumber);

try {
    $pr = getPR($prNumber);
} catch (Exception $e) {
    http_response_code(404);
    echo json_encode(['success' => false, 'error' => 'PR not found on GitHub']);
    exit;
}

// 同步 GitHub 状态到本地
$ghState = $pr['state'] ?? 'open';
$merged = !empty($pr['merged']);

if ($mapping) {
    $localStatus = 'open';
    if ($merged) $localStatus = 'merged';
    elseif ($ghState === 'closed') $localStatus = 'closed';

    if ($localStatus !== $mapping['pr_status']) {
        updatePRStatus($prNumber, $localStatus);
    }
}

echo json_encode([
    'success'   => true,
    'pr_number' => $prNumber,
    'state'     => $ghState,
    'merged'    => $merged,
    'draft'     => !empty($pr['draft']),
    'title'     => $pr['title'] ?? '',
    'pr_url'    => $pr['html_url'] ?? '',
    'created_at'=> $pr['created_at'] ?? '',
    'updated_at'=> $pr['updated_at'] ?? '',
    'local'     => $mapping ? [
        'pr_type'   => $mapping['pr_type'],
        'pr_status' => $mapping['pr_status'],
        'name'      => $mapping['submitter_name'],
    ] : null,
]);
