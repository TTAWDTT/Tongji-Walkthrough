<?php
/**
 * GitHub API 封装
 */

require_once __DIR__ . '/config.php';

const GITHUB_API = 'https://api.github.com';

function githubApi(string $method, string $path, ?array $body = null): array {
    $url = GITHUB_API . $path;
    $ch = curl_init($url);

    $headers = [
        'Authorization: Bearer ' . GITHUB_TOKEN,
        'Accept: application/vnd.github+json',
        'User-Agent: Tongji-Walkthrough-Editor/1.0',
    ];

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 30,
    ]);

    if ($body !== null) {
        $json = json_encode($body);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($error) {
        http_response_code(502);
        die(json_encode(['success' => false, 'error' => 'GitHub API request failed: ' . $error]));
    }

    $data = json_decode($response, true);

    if ($httpCode >= 400) {
        $message = $data['message'] ?? 'GitHub API error';
        http_response_code(502);
        die(json_encode(['success' => false, 'error' => $message, 'github_response' => $data]));
    }

    return $data;
}

// --- 高层操作 ---

function createBranch(string $branchName): void {
    // 获取 main 分支的最新 commit SHA
    $main = githubApi('GET', '/repos/' . GITHUB_OWNER . '/' . GITHUB_REPO . '/git/ref/heads/' . GITHUB_BRANCH);
    $sha = $main['object']['sha'];

    // 创建新分支
    githubApi('POST', '/repos/' . GITHUB_OWNER . '/' . GITHUB_REPO . '/git/refs', [
        'ref' => 'refs/heads/' . $branchName,
        'sha' => $sha,
    ]);
}

function deleteBranch(string $branchName): void {
    githubApi('DELETE', '/repos/' . GITHUB_OWNER . '/' . GITHUB_REPO . '/git/refs/heads/' . $branchName);
}

function commitFile(string $branchName, string $path, string $content, string $message): array {
    return githubApi('PUT', '/repos/' . GITHUB_OWNER . '/' . GITHUB_REPO . '/contents/' . $path, [
        'branch'  => $branchName,
        'message' => $message,
        'content' => base64_encode($content),
    ]);
}

function commitFileWithSha(string $branchName, string $path, string $content, string $sha, string $message): array {
    return githubApi('PUT', '/repos/' . GITHUB_OWNER . '/' . GITHUB_REPO . '/contents/' . $path, [
        'branch'  => $branchName,
        'message' => $message,
        'content' => base64_encode($content),
        'sha'     => $sha,
    ]);
}

function deleteFile(string $branchName, string $path, string $sha, string $message): void {
    githubApi('DELETE', '/repos/' . GITHUB_OWNER . '/' . GITHUB_REPO . '/contents/' . $path, [
        'branch'  => $branchName,
        'message' => $message,
        'sha'     => $sha,
    ]);
}

function getFileContent(string $path, string $ref = 'main'): ?array {
    $data = githubApi('GET', '/repos/' . GITHUB_OWNER . '/' . GITHUB_REPO . '/contents/' . $path . '?ref=' . $ref);
    if (isset($data['content'])) {
        return [
            'content' => base64_decode($data['content']),
            'sha'     => $data['sha'],
        ];
    }
    return null;
}

function createPR(string $title, string $body, string $branchName, bool $draft = false): array {
    return githubApi('POST', '/repos/' . GITHUB_OWNER . '/' . GITHUB_REPO . '/pulls', [
        'title' => $title,
        'body'  => $body,
        'head'  => $branchName,
        'base'  => GITHUB_BRANCH,
        'draft' => $draft,
    ]);
}

function markPRReady(int $prNumber): void {
    githubApi('PATCH', '/repos/' . GITHUB_OWNER . '/' . GITHUB_REPO . '/pulls/' . $prNumber, [
        'draft' => false,
    ]);
}

function getPR(int $prNumber): array {
    return githubApi('GET', '/repos/' . GITHUB_OWNER . '/' . GITHUB_REPO . '/pulls/' . $prNumber);
}

function uploadImageFile(string $branchName, string $repoPath, string $localPath): array {
    $content = base64_encode(file_get_contents($localPath));
    return githubApi('PUT', '/repos/' . GITHUB_OWNER . '/' . GITHUB_REPO . '/contents/' . $repoPath, [
        'branch'  => $branchName,
        'message' => 'Upload image: ' . basename($repoPath),
        'content' => $content,
    ]);
}

function getRawFileUrl(string $branch, string $path): string {
    return sprintf(
        'https://raw.githubusercontent.com/%s/%s/%s/%s',
        GITHUB_OWNER, GITHUB_REPO, $branch, $path
    );
}
