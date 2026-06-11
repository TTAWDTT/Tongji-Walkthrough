# 后端部署操作指南

## 目录

- [第 1 步：上传后端文件](#第-1-步上传后端文件)
- [第 2 步：创建 MySQL 数据库和表](#第-2-步创建-mysql-数据库和表)
- [第 3 步：创建并填写 config.php](#第-3-步创建并填写-configphp)
- [第 4 步：配置 GitHub Token](#第-4-步配置-github-token)
- [第 5 步：设置目录权限](#第-5-步设置目录权限)
- [第 6 步：验证部署](#第-6-步验证部署)
- [第 7 步：设置定时清理](#第-7-步设置定时清理)
- [第 8 步：构建前端并设置 API 地址](#第-8-步构建前端并设置-api-地址)
- [常见问题](#常见问题)

---

## 第 1 步：上传后端文件

通过 FTP 将 `backend/` 目录下的所有文件上传到虚拟主机的网站根目录（或任意子目录，例如 `/api`）：

```
本地 backend/                          → 远程 / 或 /api/
├── index.php                         → index.php          (健康检查)
├── config.php                        → config.php         (配置，不上传)
├── config.example.php                → (不需要上传)
├── db.php                            → db.php
├── github.php                        → github.php
├── .htaccess                         → .htaccess
├── db/
│   └── schema.sql                    → (不需要上传，用于第 2 步)
├── api/
│   ├── cors.php                      → api/cors.php
│   ├── submit.php                    → api/submit.php
│   ├── draft.php                     → api/draft.php
│   ├── update.php                    → api/update.php
│   ├── upload.php                    → api/upload.php
│   ├── image.php                     → api/image.php
│   ├── content.php                   → api/content.php
│   ├── pr-status.php                 → api/pr-status.php
│   ├── history.php                   → api/history.php
│   └── cleanup.php                   → api/cleanup.php
└── temp/
    └── images/                       → temp/images/       (图片存储目录)
```

**FTP 信息**（你的虚拟主机）：

- FTP 地址：`171.80.8.90`（共享 IP）
- FTP 账号：`ftp6296491`（从控制台获取密码）
- 上传后目录结构应类似：`/web/api/submit.php`、`/web/api/draft.php` 等

> **注意**：`config.php` 需在第 3 步创建后再上传，不要上传 `config.example.php`。

---

## 第 2 步：创建 MySQL 数据库和表

通过虚拟主机控制面板的 **MySql 数据库** 管理功能操作：

### 方法 A：phpMyAdmin（推荐）

1. 登录虚拟主机控制面板，找到 MySql 数据库管理
2. 进入 phpMyAdmin
3. 点击 "SQL" 选项卡
4. 复制粘贴 `backend/db/schema.sql` 的全部内容
5. 点击执行

会自动创建 `tongji_walkthrough` 数据库、`pr_mappings` 表和 `image_mappings` 表。

### 方法 B：命令行导入

```sql
mysql -h 171.80.8.90 -u <数据库用户名> -p < backend/db/schema.sql
```

### 验证

导入后在 phpMyAdmin 中应看到两张表：

| 表名             | 用途                                 |
| ---------------- | ------------------------------------ |
| `pr_mappings`    | 存储 PR 编号 ↔ 用户 ↔ 分支的映射关系 |
| `image_mappings` | 存储图片文件名 ↔ PR 编号的映射       |

---

## 第 3 步：创建并填写 config.php

复制 `config.example.php` 为 `config.php`（或直接在 FTP 客户端创建），按以下说明填写：

```php
<?php

// --- GitHub ---
define('GITHUB_TOKEN', 'ghp_xxxxxxxxxxxxxxxxxxxx');       // ← 在第 4 步生成
define('GITHUB_OWNER', 'TTAWDTT');                        // 不用改
define('GITHUB_REPO', 'Tongji-Walkthrough');              // 不用改
define('GITHUB_BRANCH', 'main');                          // 不用改

// --- MySQL ---
define('DB_HOST', 'localhost');                           // 虚拟主机通常用 localhost
define('DB_PORT', 3306);                                  // 默认端口
define('DB_USER', 'ftp6296491');                          // ← 填你的 MySQL 用户名（通常在控制台可查）
define('DB_PASS', '你的MySQL密码');                        // ← 填你的 MySQL 密码
define('DB_NAME', 'tongji_walkthrough');                  // 数据库名，如果控制台有前缀加前缀

// --- CORS ---
define('ALLOWED_ORIGINS', 'https://tongji.one,https://TTAWDTT.github.io');

// --- Upload ---
define('MAX_UPLOAD_SIZE', 5 * 1024 * 1024);              // 5MB
define('ALLOWED_IMAGE_TYPES', 'jpg,jpeg,png,gif,webp');
define('IMAGE_STORAGE_PATH', __DIR__ . '/temp/images/');  // 不用改（相对路径）
define('IMAGE_REPO_PATH', 'public/images/');              // 仓库中存放图片的路径

// --- App ---
define('CONTACT_EMAIL', 'admin@tongji.one');
```

> **MySQL 连接信息**：登录三丰云控制台 → 我的虚拟主机 → 管理 → MySql 数据库，一般能看到数据库名、用户名、密码。
> 大多数虚拟主机允许用 `localhost` 连接 MySQL，端口默认 `3306`。

配置好后通过 FTP 上传 `config.php`。

---

## 第 4 步：配置 GitHub Token

### 4.1 生成 Fine-grained PAT

1. 打开 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. 点击 "Generate new token"
3. 填写：
   - **Token name**: `Tongji-Walkthrough Editor Backend`
   - **Expiration**: 无限制（或选一个远的日期）
   - **Repository access**: Only select repositories → 选择 `TTAWDTT/Tongji-Walkthrough`
   - **Permissions**:
     - Contents: **Read and write**（读写文件）
     - Pull requests: **Read and write**（创建/更新 PR）

4. 点击 "Generate token"

### 4.2 将 Token 填入 config.php

复制生成的 token（以 `github_pat_` 开头），粘贴到 `config.php` 的 `GITHUB_TOKEN` 位置。

> ⚠️ Token 只显示一次！复制后立即保存。如果丢了只能重新生成。

### 4.3 验证 Token

```bash
curl -s -H "Authorization: Bearer ghp_xxx" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/TTAWDTT/Tongji-Walkthrough
```

返回 200 且包含仓库信息即为成功。

---

## 第 5 步：设置目录权限

上传完成后，通过 FTP 设置目录权限：

| 路径             | 权限       | 说明                          |
| ---------------- | ---------- | ----------------------------- |
| `temp/images/`   | 755 或 777 | PHP 需要写入上传的图片        |
| `config.php`     | 644        | 其他人不可写（通过 FTP 修改） |
| 其他 `.php` 文件 | 644        | 默认即可                      |
| `.htaccess`      | 644        | 默认即可                      |

> 大部分虚拟主机默认就是这些权限，通常不需要手动改。
> 如果上传图片时报 500 错误，把 `temp/images/` 改成 777。

---

## 第 6 步：验证部署

上传完成后依次测试以下 URL（用浏览器或 curl）：

### 6.1 健康检查

```
http://171.80.8.90/index.php
```

预期：

```json
{
  "success": true,
  "service": "Tongji-Walkthrough Editor Backend",
  "version": "1.0.0",
  "contact": "admin@tongji.one"
}
```

### 6.2 读取文件

```
http://171.80.8.90/api/content.php?path=content/docs/introduction.md
```

预期：返回 Markdown 内容和 SHA。

### 6.3 上传图片

使用 curl 测试：

```bash
curl -s -X POST -F "image=@/path/to/test.png" http://171.80.8.90/api/upload.php
```

预期：返回包含 `markdown` 字段的 JSON。

### 6.4 图片代理

将上一步返回的 `url` 在浏览器中打开，应能直接看到图片。

### 6.5 创建 Draft PR（会创建真实的 GitHub PR）

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{
    "profile": {"studentId":"2254321","name":"测试","email":"test@test.dev","qq":"123456","github":""},
    "changes": {"modified":{"content/docs/campus-notes.md":"---\ntitle: Campus Notes\norder: 2\n---\n\n测试提交"}}
  }' \
  http://171.80.8.90/api/draft.php
```

预期：返回 `pr_number` 和 `pr_url`。在 GitHub 仓库中确认 Draft PR 已创建。

> **测试通过后记得关闭测试 PR**，避免污染仓库历史。

---

## 第 7 步：设置定时清理

在虚拟主机控制面板中找到 **计划任务 / cron 任务** 功能，添加：

```
0 3 * * * curl -s http://171.80.8.90/api/cleanup.php > /dev/null 2>&1
```

每天凌晨 3 点自动删除 24 小时前上传但未关联 PR 的孤立图片。

如果虚拟主机不支持 cron，也可以手动每月清理一次。

---

## 第 8 步：构建前端并设置 API 地址

### 在 GitHub Actions 中配置

编辑项目的 GitHub Actions 构建脚本（`.github/workflows/deploy.yml`），在构建步骤中添加环境变量：

```yaml
- name: Build
  run: bun run build
  env:
    API_BASE_URL: http://171.80.8.90/api
```

或者在 `next.config.mjs` 中直接填入（但不灵活）：

```js
env: {
  NEXT_PUBLIC_BASE_PATH: basePath,
  NEXT_PUBLIC_API_BASE_URL: "http://171.80.8.90/api",
},
```

构建部署后，访问 `https://tongji.one/edit/docs`，编辑器应能通过 PHP 后端创建和维护 PR。

---

## 常见问题

### Q: 上传文件后访问返回 404？

→ 确认文件已上传到正确的目录。虚拟主机网站根目录可能与本地路径不同（可能是 `/web`、`/wwwroot`、`/htdocs` 等）。在 FTP 中查看哪个目录下有 `index.html` 或 `cgi-bin`，那里就是根目录。

### Q: 访问 API 返回 500 错误？

→ 检查以下可能原因：

1. **PHP 版本**：登录控制台 → PHP 版本设置，确认已启用 PHP（建议 PHP 8.0+）
2. **PHP 扩展**：确认已开启 `curl` 和 `mysqli` 扩展。通常在控制台有 "PHP 扩展设置" 页面
3. **config.php**：检查 MySQL 连接信息是否正确。可以先创建一个简单的测试文件确认 PHP 正常运行
4. **文件权限**：`temp/images/` 需要可写权限

### Q: 三丰云面板找不到 MySQL 管理入口？

→ 在虚拟主机管理页面中找 "MySql 数据库" 或 "数据库管理" 链接。有些面板需要先创建数据库用户再创建数据库。

### Q: 提示 `call to undefined function mysqli_connect`？

→ PHP 的 `mysqli` 扩展未开启。在控制面板的 PHP 配置中找到 "PHP 扩展" 或 "组件"，勾选 `mysqli` 后保存。

### Q: 上传图片失败（文件大小限制）？

虚拟主机的 PHP 默认 `upload_max_filesize` 通常是 2MB～8MB。我们的代码限制 5MB。如果上传大图失败：

- 在 `config.php` 中减小 `MAX_UPLOAD_SIZE` 的值
- 或者联系服务商提高 PHP 上传限制

### Q: `.htaccess` 不生效？

部分虚拟主机使用 Nginx 而非 Apache，不支持 `.htaccess`。此时：

- `config.php` 的安全性依赖目录权限（设置 644 可读不可写即可）
- 不存在安全问题，因为 PHP 文件不会被直接下载（PHP 解释器会执行它们，而不是输出源码）

### Q: 怎么看 PHP 错误日志？

联系三丰云客服获取错误日志路径，或者在 PHP 文件开头加：

```php
ini_set('display_errors', 1);
error_reporting(E_ALL);
```

但部署时记得去掉，避免泄露敏感信息。
