-- Tongji-Walkthrough 编辑器后端 - 数据库建表

CREATE DATABASE IF NOT EXISTS tongji_walkthrough
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE tongji_walkthrough;

-- PR 映射表
CREATE TABLE IF NOT EXISTS pr_mappings (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  pr_number       INT NOT NULL COMMENT 'GitHub PR 编号',
  branch_name     VARCHAR(255) NOT NULL COMMENT 'GitHub 分支名',
  pr_type         ENUM('draft','ready') NOT NULL DEFAULT 'draft' COMMENT 'draft=暂存, ready=正式提交',
  pr_status       ENUM('open','closed','merged') NOT NULL DEFAULT 'open' COMMENT 'GitHub PR 状态',
  student_id      VARCHAR(64) NOT NULL COMMENT '学号',
  submitter_name  VARCHAR(128) NOT NULL COMMENT '姓名',
  submitter_email VARCHAR(255) NOT NULL COMMENT '邮箱',
  submitter_qq    VARCHAR(32) DEFAULT NULL COMMENT 'QQ',
  submitter_github VARCHAR(255) DEFAULT NULL COMMENT 'GitHub 用户名',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',

  UNIQUE KEY uk_branch (branch_name),
  INDEX idx_pr_number (pr_number),
  INDEX idx_email (submitter_email),
  INDEX idx_status (pr_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='PR 映射关系表';

-- 图片映射表
CREATE TABLE IF NOT EXISTS image_mappings (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  filename        VARCHAR(255) NOT NULL COMMENT '图片文件名 (xxx.jpg)',
  original_name   VARCHAR(255) NOT NULL COMMENT '原始文件名',
  pr_number       INT DEFAULT NULL COMMENT '关联的 PR 编号 (NULL=未关联)',
  branch_committed TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已写入仓库分支',
  file_size       INT NOT NULL DEFAULT 0 COMMENT '文件大小(字节)',
  mime_type       VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'MIME 类型',
  uploader_email  VARCHAR(255) DEFAULT NULL COMMENT '上传者邮箱',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_filename (filename),
  INDEX idx_pr_number (pr_number),
  INDEX idx_email (uploader_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='图片映射表';
