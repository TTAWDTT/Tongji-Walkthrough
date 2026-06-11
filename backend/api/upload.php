<?php
/**
 * 图片上传 API
 *
 * POST /api/upload.php
 * Content-Type: multipart/form-data
 *
 * Parameters:
 *   image        - 图片文件 (required)
 *   pr_number    - 关联的 PR 编号 (optional, 首次上传时可为空)
 *   email        - 上传者邮箱 (optional)
 *
 * 返回:
 *   - 图片写入 /temp/images/ (始终)
 *   - 如果传了 pr_number，同时写入仓库分支
 *   - 返回 PHP 代理 URL (永久有效)
 */

require_once __DIR__ . '/cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../github.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

// --- 校验上传 ---

if (!isset($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'No image uploaded or upload error']);
    exit;
}

$file = $_FILES['image'];
$originalName = basename($file['name']);
$tmpPath = $file['tmp_name'];
$fileSize = $file['size'];
$mimeType = $file['type'];

// 校验文件类型
$ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
$allowedExts = explode(',', ALLOWED_IMAGE_TYPES);
if (!in_array($ext, $allowedExts, true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid file type. Allowed: ' . ALLOWED_IMAGE_TYPES]);
    exit;
}

// 校验文件大小
if ($fileSize > MAX_UPLOAD_SIZE) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'File too large. Max: ' . (MAX_UPLOAD_SIZE / 1024 / 1024) . 'MB']);
    exit;
}

// 校验真实 MIME (通过 finfo)
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$detectedMime = finfo_file($finfo, $tmpPath);
finfo_close($finfo);
$allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
if (!in_array($detectedMime, $allowedMimes, true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid image content']);
    exit;
}

// --- 处理 ---

$prNumber = isset($_POST['pr_number']) ? (int)$_POST['pr_number'] : null;
$email = $_POST['email'] ?? null;

// 生成唯一文件名
$uniqueName = 'upload_' . dechex(time()) . '_' . bin2hex(random_bytes(8)) . '.' . $ext;

// 保存到本地
$storagePath = IMAGE_STORAGE_PATH . $uniqueName;
if (!move_uploaded_file($tmpPath, $storagePath)) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Failed to save file']);
    exit;
}

$branchCommitted = 0;

// 如果有 pr_number，同时写入仓库分支
if ($prNumber !== null) {
    $pr = findPRByNumber($prNumber);
    if ($pr && in_array($pr['pr_status'], ['open', 'draft'], true)) {
        $branchName = $pr['branch_name'];
        $repoPath = IMAGE_REPO_PATH . $uniqueName;
        try {
            uploadImageFile($branchName, $repoPath, $storagePath);
            $branchCommitted = 1;
        } catch (Exception $e) {
            // 写入仓库失败不阻塞，本地文件已有
        }
    }
}

// 记录到数据库
$imageData = [
    'filename'        => $uniqueName,
    'original_name'   => $originalName,
    'pr_number'       => $prNumber,
    'branch_committed'=> $branchCommitted,
    'file_size'       => $fileSize,
    'mime_type'       => $detectedMime,
    'uploader_email'  => $email,
];

try {
    insertImageMapping($imageData);
} catch (Exception $e) {
    // DB 写入失败不阻塞
}

// 构建 URL - 使用 PHP 代理地址
$protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$imageUrl = $protocol . '://' . $host . '/api/image.php?id=' . urlencode($uniqueName);

echo json_encode([
    'success'    => true,
    'filename'   => $uniqueName,
    'path'       => IMAGE_REPO_PATH . $uniqueName,
    'url'        => $imageUrl,
    'markdown'   => '![' . pathinfo($originalName, PATHINFO_FILENAME) . '](' . $imageUrl . ')',
    'file_size'  => $fileSize,
]);
