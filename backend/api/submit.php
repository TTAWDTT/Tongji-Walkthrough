<?php
/**
 * 创建正式 PR
 *
 * POST /api/submit.php
 *
 * 流程:
 *   1. 校验 profile + changes
 *   2. 生成唯一分支名
 *   3. 从 main 创建新分支
 *   4. 写入所有文件 (modified/created)
 *   5. 删除 deleted 的文件
 *   6. 将未关联 PR 的图片写入分支
 *   7. 创建正式 PR
 *   8. 写入数据库
 */

require_once __DIR__ . '/cors.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../github.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!$input || !isset($input['profile'], $input['changes'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing profile or changes']);
    exit;
}

// --- 校验 profile ---

$profile = $input['profile'];
$errors = [];
if (empty($profile['studentId'])) $errors[] = 'Missing studentId';
if (empty($profile['name']))       $errors[] = 'Missing name';
if (empty($profile['email']))      $errors[] = 'Missing email';
if (empty($profile['qq']) && empty($profile['github'])) {
    $errors[] = 'Either qq or github is required';
}

if ($errors) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Validation failed', 'details' => $errors]);
    exit;
}

// --- 校验 changes ---

$changes = $input['changes'];
$modified = $changes['modified'] ?? [];
$created  = $changes['created'] ?? [];
$deleted  = $changes['deleted'] ?? [];
$imageFiles = $changes['images'] ?? [];

$hasChanges = !empty($modified) || !empty($created) || !empty($deleted) || !empty($imageFiles);
if (!$hasChanges) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'No changes to submit']);
    exit;
}

// --- 生成分支名 ---

$sanitizedName = preg_replace('/[^a-zA-Z0-9_-]/', '', str_replace(' ', '_', $profile['name']));
if ($sanitizedName === '') $sanitizedName = 'user';
$timestamp = date('Ymd-His');
$branchName = 'edit/' . $sanitizedName . '/' . $timestamp;

// --- 创建分支 ---

try {
    createBranch($branchName);
} catch (Exception $e) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Failed to create branch: ' . $e->getMessage()]);
    exit;
}

// --- 写入文件 ---

$totalFiles = count($modified) + count($created) + count($deleted);
$commitPrefix = '[编辑] ' . $profile['name'] . ': ';

try {
    foreach ($modified as $filePath => $content) {
        $sha = getFileContent($filePath, $branchName)['sha'] ?? null;
        // 先尝试从 main 获取 sha（已存在的文件）
        if (!$sha) {
            $existing = getFileContent($filePath, GITHUB_BRANCH);
            $sha = $existing ? $existing['sha'] : null;
        }
        // 没有 sha = 新文件，用 commitFile
        if ($sha) {
            commitFileWithSha($branchName, $filePath, $content, $sha, $commitPrefix . 'Update ' . basename($filePath));
        } else {
            commitFile($branchName, $filePath, $content, $commitPrefix . 'Create ' . basename($filePath));
        }
        usleep(200000); // 200ms 间隔避免 GitHub API 限流
    }

    foreach ($created as $filePath => $content) {
        commitFile($branchName, $filePath, $content, $commitPrefix . 'Create ' . basename($filePath));
        usleep(200000);
    }

    foreach ($deleted as $filePath) {
        $existing = getFileContent($filePath, $branchName);
        if ($existing) {
            deleteFile($branchName, $filePath, $existing['sha'], $commitPrefix . 'Delete ' . basename($filePath));
            usleep(200000);
        }
    }

    // 处理图片：将未写入分支的图片写入
    foreach ($imageFiles as $imageInfo) {
        if (is_string($imageInfo)) {
            // 如果是字符串，视为已上传的图片文件名
            $localPath = IMAGE_STORAGE_PATH . $imageInfo;
            if (file_exists($localPath)) {
                $repoPath = IMAGE_REPO_PATH . $imageInfo;
                uploadImageFile($branchName, $repoPath, $localPath);
                markImageCommitted($imageInfo, 0); // 后面更新 PR number
                usleep(200000);
            }
        } elseif (is_array($imageInfo) && isset($imageInfo['local_filename'])) {
            $localPath = IMAGE_STORAGE_PATH . $imageInfo['local_filename'];
            if (file_exists($localPath)) {
                $repoPath = IMAGE_REPO_PATH . $imageInfo['local_filename'];
                uploadImageFile($branchName, $repoPath, $localPath);
                usleep(200000);
            }
        }
    }
} catch (Exception $e) {
    // 清理分支
    try { deleteBranch($branchName); } catch (Exception $ignored) {}
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'File commit failed: ' . $e->getMessage()]);
    exit;
}

// --- 构建 PR 标题和内容 ---

$modifiedCount = count($modified);
$createdCount  = count($created);
$deletedCount  = count($deleted);
$imageCount    = count($imageFiles);

$prTitle = '[编辑] ' . $profile['name'];
$parts = [];
if ($modifiedCount > 0) $parts[] = "修改 {$modifiedCount} 个文档";
if ($createdCount > 0)  $parts[] = "新增 {$createdCount} 个文档";
if ($deletedCount > 0)  $parts[] = "删除 {$deletedCount} 个文档";
if ($imageCount > 0)    $parts[] = "新增 {$imageCount} 张图片";
$prTitle .= ' - ' . implode('，', $parts);

$prBody = "由 Tongji-Walkthrough 编辑平台提交\n\n"
    . "## 提交者信息\n"
    . "- **学号**: {$profile['studentId']}\n"
    . "- **姓名**: {$profile['name']}\n"
    . "- **邮箱**: {$profile['email']}\n"
    . ($profile['qq'] ? "- **QQ**: {$profile['qq']}\n" : '')
    . ($profile['github'] ? "- **GitHub**: @{$profile['github']}\n" : '')
    . "\n## 变更摘要\n"
    . "- 修改文件: {$modifiedCount} 个\n"
    . "- 新增文件: {$createdCount} 个\n"
    . "- 删除文件: {$deletedCount} 个\n"
    . "- 新增图片: {$imageCount} 个\n"
    . "\n---\n"
    . "_此 PR 通过 [Tongji-Walkthrough 编辑器](" . (isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : 'https://tongji.one') . ") 自动生成_";

// --- 创建 PR ---

try {
    $pr = createPR($prTitle, $prBody, $branchName, false);
} catch (Exception $e) {
    try { deleteBranch($branchName); } catch (Exception $ignored) {}
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'PR creation failed: ' . $e->getMessage()]);
    exit;
}

$prNumber = $pr['number'];

// --- 写入数据库 ---

insertPRMapping([
    'pr_number'       => $prNumber,
    'branch_name'     => $branchName,
    'pr_type'         => 'ready',
    'student_id'      => $profile['studentId'],
    'submitter_name'  => $profile['name'],
    'submitter_email' => $profile['email'],
    'submitter_qq'    => $profile['qq'] ?? '',
    'submitter_github'=> $profile['github'] ?? '',
]);

// 更新之前上传的图片 PR 关联
foreach ($imageFiles as $imageInfo) {
    $filename = is_string($imageInfo) ? $imageInfo : ($imageInfo['local_filename'] ?? null);
    if ($filename) {
        markImageCommitted($filename, $prNumber);
    }
}

echo json_encode([
    'success'   => true,
    'pr_number' => $prNumber,
    'pr_url'    => $pr['html_url'],
    'branch'    => $branchName,
    'summary'   => [
        'modified' => $modifiedCount,
        'created'  => $createdCount,
        'deleted'  => $deletedCount,
        'images'   => $imageCount,
    ],
]);
