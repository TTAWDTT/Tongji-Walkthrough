<?php
/**
 * Tongji-Walkthrough 编辑器后端 - 健康检查
 */

require_once __DIR__ . '/config.php';

header('Content-Type: application/json');

echo json_encode([
    'success' => true,
    'service' => 'Tongji-Walkthrough Editor Backend',
    'version' => '1.0.0',
    'contact' => CONTACT_EMAIL,
]);
