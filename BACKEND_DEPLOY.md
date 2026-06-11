# 后端部署操作指南 (Cloudflare Workers)

后端架构已从三丰云虚拟主机 PHP 迁移到 **Cloudflare Workers + KV + R2**，零服务器、零运维、无需备案、自带 HTTPS。

## 总体架构

```
前端 (tongji.one)
    │
    ├── POST /api/draft          → 创建 Draft PR
    ├── POST /api/submit         → 创建正式 PR
    ├── POST /api/update         → 更新已有 PR + 可选 Promote
    ├── POST /api/upload         → 上传图片到 R2 + 写入仓库分支
    ├── GET  /api/image?id=xxx   → 图片代理（从 R2 读取）
    ├── GET  /api/content        → 读取仓库文件
    ├── GET  /api/pr-status      → 查询 PR 状态
    ├── GET  /api/history        → 按邮箱/学号查询历史
    └── GET  /api/cleanup        → 清理 24h 孤立图片
```

**核心差异 vs PHP 方案**：

| 功能        | PHP 方案                  | Workers 方案                 |
| ----------- | ------------------------- | ---------------------------- |
| PR 映射存储 | MySQL (200MB)             | Workers KV（无限 key）       |
| 图片存储    | 本地磁盘 temp/ + Git 仓库 | R2 对象存储                  |
| 图片代理    | image.php fallback 链     | R2 直接读（CDN 加速）        |
| 部署        | FTP 上传 PHP 文件         | `wrangler deploy` 一行命令   |
| 域名        | 需要备案                  | `*.workers.dev` 免备案       |
| 费用        | 免费                      | 免费（10万请求/天 + 1GB R2） |
| CRON        | 需虚拟主机 cron 功能      | Worker 内建 Cron Triggers    |

## 部署步骤

### 第 1 步：安装 Wrangler CLI

```bash
cd workers/editor-backend
npm install
```

### 第 2 步：创建 KV 命名空间

```bash
npx wrangler kv namespace create EDITOR_KV
```

输出：

```
🌀 Creating namespace with title "tongji-walkthrough-editor-backend-EDITOR_KV"
✨ Success!
Add the following to your wrangler.toml:

[[kv_namespaces]]
binding = "EDITOR_KV"
id = "abc123..."
```

将输出的 `id` 复制到 `wrangler.toml` 中。

### 第 3 步：创建 R2 存储桶

```bash
npx wrangler r2 bucket create tongji-walkthrough-images
```

### 第 4 步：配置 GitHub Token

```bash
npx wrangler secret put GITHUB_TOKEN
```

提示时输入 Fine-grained PAT（生成方式见下方）。

### 第 5 步：配置 BASE_URL

```bash
npx wrangler secret put BASE_URL
```

提示时输入你的 Worker 域名：

```
https://tongji-walkthrough-editor-backend.YOUR-SUBDOMAIN.workers.dev
```

也可以用自定义域名（CF 面板中配置）。

### 第 6 步：部署

```bash
npx wrangler deploy
```

### 第 7 步：验证

```bash
curl https://tongji-walkthrough-editor-backend.YOUR-SUBDOMAIN.workers.dev/
```

预期：

```json
{
  "success": true,
  "service": "Tongji-Walkthrough Editor Backend",
  "version": "2.0.0"
}
```

## GitHub Token 配置

### 生成 Fine-grained PAT

1. 打开 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Generate new token
3. **Token name**: `Tongji-Walkthrough Editor Backend`
4. **Repository access**: Only select repositories → `TTAWDTT/Tongji-Walkthrough`
5. **Permissions**:
   - Contents: **Read and write**
   - Pull requests: **Read and write**
6. Generate → 复制 token（以 `github_pat_` 开头）

### 存入 Worker

```bash
npx wrangler secret put GITHUB_TOKEN
# → 粘贴 token
```

## 前端配置

将 `NEXT_PUBLIC_API_BASE_URL` 设为你的 Worker 域名（不含尾随路径 `/api`）：

```
NEXT_PUBLIC_API_BASE_URL=https://tongji-walkthrough-editor-backend.YOUR-SUBDOMAIN.workers.dev
```

在 GitHub Actions 的 `pages.yml` 中设置：

```yaml
env:
  API_BASE_URL: https://tongji-walkthrough-editor-backend.YOUR-SUBDOMAIN.workers.dev
```

## 本地开发

```bash
cd workers/editor-backend

# 本地起 dev server (需要配置 dev 环境的 GITHUB_TOKEN)
npx wrangler secret put GITHUB_TOKEN  # 如果还没配

# 启动开发服务器
npm run dev
```

## 常见问题

### Q: 如何绑定自定义域名？

Cloudflare Dashboard → Workers & Pages → 选择你的 Worker → Triggers → Custom Domains → Add Custom Domain

### Q: 免费额度够用吗？

- Workers：10 万请求/天（学生用户完全足够）
- KV：1000 次写入/天，3000 万次读取/月（存储量极小）
- R2：1GB 存储 + 每月 1000 万次读取（免费）

### Q: 需要信用卡吗？

不需要。Cloudflare Workers 免费计划不需要绑定支付方式。

### Q: 如何查看日志？

```bash
npx wrangler tail
```

### Q: 如何更新代码？

```bash
cd workers/editor-backend
git pull          # 拉取最新代码
npx wrangler deploy  # 重新部署（无感更新）
```
