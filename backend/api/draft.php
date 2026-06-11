<?php
/**
 * 创建 Draft PR (暂存)
 *
 * 与 submit.php 流程相同，仅 PR 的 draft 参数不同。
 * 首次暂存时创建 Draft PR；后续通过 update.php 更新。
 *
 * POST /api/draft.php
 * 请求格式与 submit.php 相同
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

// --- 复用 submit.php 的校验逻辑 ---
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

// --- 生成分支名并进行与 submit 相同的操作 ---

$sanitizedName = preg_replace('/[^a-zA-Z0-9_-]/', '', str_replace(' ', '_', $profile['name']));
if ($sanitizedName === '') $sanitizedName = 'user';
$timestamp = date('Ymd-His');
$branchName = 'edit/' . $sanitizedName . '/' . $timestamp;

try {
    createBranch($branchName);
} catch (Exception $e) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Failed to create branch: ' . $e->getMessage()]);
    exit;
}

$commitPrefix = '[暂存] ' . $profile['name'] . ': ';

try {
    foreach ($modified as $filePath => $content) {
        $sha = null;
        $existing = getFileContent($filePath, GITHUB_BRANCH);
        $sha = $existing ? $existing['sha'] : null;
        if ($sha) {
            commitFileWithSha($branchName, $filePath, $content, $sha, $commitPrefix . 'Update ' . basename($filePath));
        } else {
            commitFile($branchName, $filePath, $content, $commitPrefix . 'Create ' . basename($filePath));
        }
        usleep(200000);
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

    foreach ($imageFiles as $imageInfo) {
        $localFilename = is_string($imageInfo) ? $imageInfo : ($imageInfo['local_filename'] ?? null);
        if ($localFilename) {
            $localPath = IMAGE_STORAGE_PATH . $localFilename;
            if (file_exists($localPath)) {
                $repoPath = IMAGE_REPO_PATH . $localFilename;
                uploadImageFile($branchName, $repoPath, $localPath);
                usleep(200000);
            }
        }
    }
} catch (Exception $e) {
    try { deleteBranch($branchName); } catch (Exception $ignored) {}
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'File commit failed: ' . $e->getMessage()]);
    exit;
}

// --- PR 标题与 body ---

$modifiedCount = count($modified);
$createdCount  = count($created);
$deletedCount  = count($deleted);
$imageCount    = count($imageFiles);

$prTitle = '[暂存] ' . $profile['name'];
$parts = [];
if ($modifiedCount > 0) $parts[] = "修改 {$modifiedCount} 个文档";
if ($createdCount > 0)  $parts[] = "新增 {$createdCount} 个文档";
if ($deletedCount > 0)  $parts[] = "删除 {$deletedCount} 个文档";
if ($imageCount > 0)    $parts[] = "新增 {$imageCount} 张图片";
$prTitle .= ' - ' . implode('，', $parts);

$prBody = "由 Tongji-Walkthrough 编辑平台提交 (暂存)\n\n"
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
    . "\n> 此 PR 为暂存版本 (Draft)。提交者后续可通过编辑平台继续更新内容。" . "\n"
    . "_此 PR 通过 [Tongji-Walkthrough 编辑器](" . (isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : 'https://tongji.one') . ") 自动生成_";

try {
    $pr = createPR($prTitle, $prBody, $branchName, true);
} catch (Exception $e) {
    try { deleteBranch($branchName); } catch (Exception $ignored) {}
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Draft PR creation failed: ' . $e->getMessage()]);
    exit;
}

$prNumber = $pr['number'];

insertPRMapping([
    'pr_number'       => $prNumber,
    'branch_name'     => $branchName,
    'pr_type'         => 'draft',
    'student_id'      => $profile['studentId'],
    'submitter_name'  => $profile['name'],
    'submitter_email' => $profile['email'],
    'submitter_qq'    => $profile['qq'] ?? '',
    'submitter_github'=> $profile['github'] ?? '',
]);

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
    'pr_type'   => 'draft',
    'branch'    => $branchName,
    'summary'   => [
        'modified' => $modifiedCount,
        'created'  => $createdCount,
        'deleted'  => $deletedCount,
        'images'   => $imageCount,
    ],
]);
