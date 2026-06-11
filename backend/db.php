<?php
/**
 * 数据库连接封装
 */

require_once __DIR__ . '/config.php';

function getDB(): mysqli {
    static $conn = null;
    if ($conn === null) {
        $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT);
        if ($conn->connect_error) {
            http_response_code(500);
            die(json_encode(['success' => false, 'error' => 'Database connection failed']));
        }
        $conn->set_charset('utf8mb4');
    }
    return $conn;
}

function findPRByNumber(int $prNumber): ?array {
    $db = getDB();
    $stmt = $db->prepare("SELECT * FROM pr_mappings WHERE pr_number = ?");
    $stmt->bind_param('i', $prNumber);
    $stmt->execute();
    $result = $stmt->get_result();
    return $result->fetch_assoc() ?: null;
}

function findPRByEmail(string $email): array {
    $db = getDB();
    $stmt = $db->prepare("SELECT * FROM pr_mappings WHERE submitter_email = ? ORDER BY created_at DESC");
    $stmt->bind_param('s', $email);
    $stmt->execute();
    return $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
}

function insertPRMapping(array $data): void {
    $db = getDB();
    $stmt = $db->prepare(
        "INSERT INTO pr_mappings (pr_number, branch_name, pr_type, pr_status, student_id, submitter_name, submitter_email, submitter_qq, submitter_github)
         VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)"
    );
    $stmt->bind_param(
        'isssssss',
        $data['pr_number'],
        $data['branch_name'],
        $data['pr_type'],
        $data['student_id'],
        $data['submitter_name'],
        $data['submitter_email'],
        $data['submitter_qq'],
        $data['submitter_github']
    );
    $stmt->execute();
}

function updatePRStatus(int $prNumber, string $status): void {
    $db = getDB();
    $stmt = $db->prepare("UPDATE pr_mappings SET pr_status = ? WHERE pr_number = ?");
    $stmt->bind_param('si', $status, $prNumber);
    $stmt->execute();
}

function insertImageMapping(array $data): void {
    $db = getDB();
    $stmt = $db->prepare(
        "INSERT INTO image_mappings (filename, original_name, pr_number, branch_committed, file_size, mime_type, uploader_email)
         VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    $stmt->bind_param(
        'ssiiiss',
        $data['filename'],
        $data['original_name'],
        $data['pr_number'],
        $data['branch_committed'],
        $data['file_size'],
        $data['mime_type'],
        $data['uploader_email']
    );
    $stmt->execute();
}

function markImageCommitted(string $filename, int $prNumber): void {
    $db = getDB();
    $stmt = $db->prepare("UPDATE image_mappings SET branch_committed = 1, pr_number = ? WHERE filename = ?");
    $stmt->bind_param('is', $prNumber, $filename);
    $stmt->execute();
}

function findImageByFilename(string $filename): ?array {
    $db = getDB();
    $stmt = $db->prepare("SELECT * FROM image_mappings WHERE filename = ?");
    $stmt->bind_param('s', $filename);
    $stmt->execute();
    $result = $stmt->get_result();
    return $result->fetch_assoc() ?: null;
}
