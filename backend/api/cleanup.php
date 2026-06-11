<?php
/**
 * 清理未关联 PR 的孤立图片
 *
 * 删除 24 小时前上传、且至今未关联到任何 PR 的图片文件及数据库记录。
 *
 * 建议通过 cron 每天运行一次：
 *   0 3 * * * curl -s http://.../api/cleanup.php
 *   0 3 * * * /usr/bin/php /path/to/backend/api/cleanup.php
 */

require_once __DIR__ . '/cors.php';
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../db.php';

$db = getDB();
$cutoff = date('Y-m-d H:i:s', strtotime('-24 hours'));

// 找出要清理的记录
$stmt = $db->prepare(
    "SELECT filename FROM image_mappings
     WHERE pr_number IS NULL AND created_at < ?"
);
$stmt->bind_param('s', $cutoff);
$stmt->execute();
$rows = $stmt->get_result();

$deleted = ['files' => 0, 'records' => 0];

while ($row = $rows->fetch_assoc()) {
    $filename = $row['filename'];
    $localPath = IMAGE_STORAGE_PATH . $filename;

    // 删除本地文件
    if (file_exists($localPath)) {
        unlink($localPath);
        $deleted['files']++;
    }

    // 删除数据库记录
    $delStmt = $db->prepare("DELETE FROM image_mappings WHERE filename = ?");
    $delStmt->bind_param('s', $filename);
    $delStmt->execute();
    $deleted['records']++;
}

echo json_encode([
    'success' => true,
    'cleaned' => $deleted,
    'cutoff'  => $cutoff,
]);
