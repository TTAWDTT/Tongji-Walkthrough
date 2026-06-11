<?php
/**
 * 查询用户历史提交记录
 *
 * GET /api/history.php?email=zhangsan@tongji.edu.cn    (按邮箱)
 * GET /api/history.php?student_id=2254321               (按学号)
 */

require_once __DIR__ . '/cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../github.php';

$email     = $_GET['email'] ?? '';
$studentId = $_GET['student_id'] ?? '';

if (empty($email) && empty($studentId)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing email or student_id']);
    exit;
}

$db = getDB();

if ($email) {
    $stmt = $db->prepare("SELECT * FROM pr_mappings WHERE submitter_email = ? ORDER BY updated_at DESC LIMIT 50");
    $stmt->bind_param('s', $email);
} else {
    $stmt = $db->prepare("SELECT * FROM pr_mappings WHERE student_id = ? ORDER BY updated_at DESC LIMIT 50");
    $stmt->bind_param('s', $studentId);
}

$stmt->execute();
$rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);

// 尽量同步 GitHub 状态（只同步最近的 5 条）
foreach (array_slice($rows, 0, 5) as &$row) {
    try {
        $pr = getPR((int)$row['pr_number']);
        $ghState = $pr['state'] ?? 'open';
        $merged = !empty($pr['merged']);
        $localStatus = 'open';
        if ($merged) $localStatus = 'merged';
        elseif ($ghState === 'closed') $localStatus = 'closed';
        $row['pr_status'] = $localStatus;
        $row['pr_url'] = $pr['html_url'] ?? '';
    } catch (Exception $e) {
        $row['pr_url'] = "https://github.com/" . GITHUB_OWNER . "/" . GITHUB_REPO . "/pull/{$row['pr_number']}";
    }
}
unset($row);

echo json_encode([
    'success' => true,
    'records' => $rows,
]);
