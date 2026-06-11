<?php
/**
 * Tongji-Walkthrough 编辑器后端配置
 *
 * 复制此文件为 config.php，填写真实值。
 * config.php 已在 .gitignore 中忽略，不会提交。
 */

// --- GitHub ---
define('GITHUB_TOKEN', 'ghp_xxxxxxxxxxxxxxxxxxxx');       // Fine-grained PAT
define('GITHUB_OWNER', 'TTAWDTT');                        // 仓库 owner
define('GITHUB_REPO', 'Tongji-Walkthrough');              // 仓库名
define('GITHUB_BRANCH', 'main');                          // 基础分支

// --- MySQL ---
define('DB_HOST', 'localhost');
define('DB_PORT', 3306);
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'tongji_walkthrough');

// --- CORS ---
define('ALLOWED_ORIGINS', 'https://tongji.one,https://TTAWDTT.github.io');

// --- Upload ---
define('MAX_UPLOAD_SIZE', 5 * 1024 * 1024);              // 5MB
define('ALLOWED_IMAGE_TYPES', 'jpg,jpeg,png,gif,webp');
define('IMAGE_STORAGE_PATH', __DIR__ . '/temp/images/');
define('IMAGE_REPO_PATH', 'public/images/');              // 仓库中的路径

// --- App ---
define('CONTACT_EMAIL', 'admin@tongji.one');
