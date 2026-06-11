<?php
/**
 * CORS 头设置
 *
 * 所有 API 入口文件 require 此文件。
 * 只允许配置的域名跨域访问。
 */

require_once __DIR__ . '/../config.php';

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigins = array_map('trim', explode(',', ALLOWED_ORIGINS));

if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Client-Id');
    header('Access-Control-Max-Age: 86400');
}

// 预检请求直接返回
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
