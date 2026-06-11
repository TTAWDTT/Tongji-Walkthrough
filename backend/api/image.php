<?php
/**
 * 图片代理 - 提供永久可访问的图片 URL
 *
 * 读取策略 (fallback 链):
 *   1. 从 GitHub branch raw 读取 (如果有关联 PR 且分支存在)
 *   2. 从本地 temp/ 读取 (fallback)
 *
 * GET /api/image.php?id=xxx.jpg
 */

require_once __DIR__ . '/cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../github.php';

$id = $_GET['id'] ?? '';
if (!$id || preg_match('/[^a-zA-Z0-9._-]/', $id)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid image id']);
    exit;
}

// 尝试从数据库获取信息
$image = findImageByFilename($id);
$localPath = IMAGE_STORAGE_PATH . $id;

// 策略 1: 如果有关联 PR，尝试从 GitHub raw 读取
if ($image && $image['branch_committed'] && $image['pr_number']) {
    $pr = findPRByNumber($image['pr_number']);
    if ($pr) {
        $branchName = $pr['branch_name'];
        $rawUrl = getRawFileUrl($branchName, IMAGE_REPO_PATH . $id);

        $ch = curl_init($rawUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_USERAGENT      => 'Tongji-Walkthrough-Editor/1.0',
        ]);

        // 如果 PR 已合并，也从 main 尝试
        if ($pr['pr_status'] === 'merged') {
            $mainUrl = getRawFileUrl(GITHUB_BRANCH, IMAGE_REPO_PATH . $id);
            curl_setopt($ch, CURLOPT_URL, $mainUrl);
        }

        $imageContent = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode === 200 && $imageContent) {
            $mimeType = $image['mime_type'] ?: 'image/jpeg';
            header('Content-Type: ' . $mimeType);
            header('Cache-Control: public, max-age=31536000');
            header('X-Source: github-raw');
            echo $imageContent;
            exit;
        }
    }
}

// 策略 2: 从本地文件读取 (fallback)
if (file_exists($localPath)) {
    $mimeType = mime_content_type($localPath) ?: 'image/jpeg';
    header('Content-Type: ' . $mimeType);
    header('Cache-Control: public, max-age=31536000');
    header('X-Source: local-fallback');
    readfile($localPath);
    exit;
}

// 都没找到
http_response_code(404);
echo json_encode(['success' => false, 'error' => 'Image not found']);
