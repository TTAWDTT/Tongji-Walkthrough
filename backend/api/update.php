<?php
/**
 * 更新已有 PR（迭代编辑）
 *
 * POST /api/update.php
 *
 * 两种模式:
 *   - update only: 用已有分支，追加新 commit，不改变 PR draft/ready 状态
 *   - promote: 用已有分支，更新内容，并将 draft PR → ready PR
 *
 * 请求体:
 * {
 *   "pr_number": 42,           // 已有 PR 编号 (required)
 *   "promote": false,          // 是否同时转为正式 PR (optional, default false)
 *   "profile": { ... },       // 需要 email 做校验
 *   "changes": { ... }        // 与 submit 格式相同
 * }
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
if (!$input || !isset($input['pr_number'], $input['profile'], $input['changes'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing pr_number, profile, or changes']);
    exit;
}

$prNumber = (int)$input['pr_number'];
$promote  = !empty($input['promote']);
$profile  = $input['profile'];
$changes  = $input['changes'];

// --- 查找 PR 映射 ---

$prMapping = findPRByNumber($prNumber);
if (!$prMapping) {
    http_response_code(404);
    echo json_encode(['success' => false, 'error' => 'PR not found in database']);
    exit;
}

// 校验邮箱（确保是同一用户）
if (!empty($profile['email']) && $profile['email'] !== $prMapping['submitter_email']) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Email mismatch: this PR belongs to a different user']);
    exit;
}

$branchName = $prMapping['branch_name'];

// --- 检查 PR 在 GitHub 上是否仍 open ---

try {
    $pr = getPR($prNumber);
    if (($pr['state'] ?? '') !== 'open') {
        http_response_code(409);
        echo json_encode(['success' => false, 'error' => 'PR is not open (current state: ' . ($pr['state'] ?? 'unknown') . '). Cannot update.']);
        exit;
    }
} catch (Exception $e) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'Failed to check PR status: ' . $e->getMessage()]);
    exit;
}

// --- 简化策略：直接更新分支上的文件 ---
// 不再删重建（会导致 PR 被 GitHub auto-close）
// 每个文件用当前分支上的 sha 进行覆写

try {
    // 先检查分支是否存在
    try {
        // 读取分支引用确认存在
        githubApi('GET', '/repos/' . GITHUB_OWNER . '/' . GITHUB_REPO . '/git/ref/heads/' . $branchName);
    } catch (Exception $e) {
        // 分支不存在，从 main 重建
        createBranch($branchName);
    }

    $modified   = $changes['modified'] ?? [];
    $created    = $changes['created'] ?? [];
    $deleted    = $changes['deleted'] ?? [];
    $imageFiles = $changes['images'] ?? [];
    $commitPrefix = '[编辑更新] ' . ($prMapping['submitter_name'] ?? 'User') . ': ';

    foreach ($modified as $filePath => $content) {
        // 先尝试从分支获取当前 sha
        $branchContent = getFileContent($filePath, $branchName);
        $sha = $branchContent ? $branchContent['sha'] : null;

        if ($sha) {
            commitFileWithSha($branchName, $filePath, $content, $sha, $commitPrefix . 'Update ' . basename($filePath));
        } else {
            // 分支上还没有这个文件，从 main 尝试
            $existing = getFileContent($filePath, GITHUB_BRANCH);
            if ($existing) {
                commitFileWithSha($branchName, $filePath, $content, $existing['sha'], $commitPrefix . 'Update ' . basename($filePath));
            } else {
                commitFile($branchName, $filePath, $content, $commitPrefix . 'Create ' . basename($filePath));
            }
        }
        usleep(200000);
    }

    foreach ($created as $filePath => $content) {
        commitFile($branchName, $filePath, $content, $commitPrefix . 'Create ' . basename($filePath));
        usleep(200000);
    }

    foreach ($deleted as $filePath) {
        $branchContent = getFileContent($filePath, $branchName);
        if ($branchContent) {
            deleteFile($branchName, $filePath, $branchContent['sha'], $commitPrefix . 'Delete ' . basename($filePath));
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
                markImageCommitted($localFilename, $prNumber);
                usleep(200000);
            }
        }
    }
} catch (Exception $e) {
    http_response_code(502);
    echo json_encode(['success' => false, 'error' => 'File commit failed: ' . $e->getMessage()]);
    exit;
}

// --- 如果 promote=true，将 Draft PR 转为 Ready ---

$converted = false;
if ($promote && ($prMapping['pr_type'] === 'draft')) {
    try {
        markPRReady($prNumber);
        $converted = true;
        // 更新数据库记录
        $db = getDB();
        $stmt = $db->prepare("UPDATE pr_mappings SET pr_type = 'ready', pr_status = 'open' WHERE pr_number = ?");
        $stmt->bind_param('i', $prNumber);
        $stmt->execute();
    } catch (Exception $e) {
        // 转换失败不阻塞，仍然返回更新成功
    }
}

echo json_encode([
    'success'   => true,
    'pr_number' => $prNumber,
    'pr_url'    => $pr['html_url'],
    'branch'    => $branchName,
    'converted' => $converted,
    'pr_type'   => $converted ? 'ready' : $prMapping['pr_type'],
]);
