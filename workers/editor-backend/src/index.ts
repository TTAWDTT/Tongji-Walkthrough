/**
 * Tongji-Walkthrough 编辑器后端 - Cloudflare Worker
 *
 * 整个后端运行在 Cloudflare Workers 上，无需 MySQL/本地存储。
 * - KV: 存储 PR 映射关系 + 图片元数据（替代 MySQL）
 * - R2: 存储上传的图片（替代本地文件系统）
 * - GitHub API: 操作仓库（创建分支、提交文件、管理 PR）
 *
 * Deploy:
 *   1. npm install && npm run deploy:kv（创建 KV 命名空间，ID 填入 wrangler.toml）
 *   2. 在 CF Dashboard 创建 R2 存储桶 tongji-walkthrough-images
 *   3. wrangler secret put GITHUB_TOKEN
 *   4. wrangler deploy
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

import type { Env, PRMapping, ImageRecord, SubmitRequest } from "./types";
import * as gh from "./github";

const app = new Hono<{ Bindings: Env }>();

// ─── CORS ───────────────────────────────────────────────────────────────

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = c.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
      if (allowed.includes("*")) return origin;
      return allowed.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

// ─── KV Helpers ────────────────────────────────────────────────────────

const KV_PR = "pr:";
const KV_IMG = "img:";

async function getPR(env: Env, n: number): Promise<PRMapping | null> {
  return (await env.EDITOR_KV.get(`${KV_PR}${n}`, "json")) as PRMapping | null;
}

async function setPR(env: Env, n: number, m: PRMapping): Promise<void> {
  await env.EDITOR_KV.put(`${KV_PR}${n}`, JSON.stringify(m));
}

async function getImg(env: Env, f: string): Promise<ImageRecord | null> {
  return (await env.EDITOR_KV.get(
    `${KV_IMG}${f}`,
    "json",
  )) as ImageRecord | null;
}

async function setImg(env: Env, f: string, r: ImageRecord): Promise<void> {
  await env.EDITOR_KV.put(`${KV_IMG}${f}`, JSON.stringify(r));
}

// ─── Routes ────────────────────────────────────────────────────────────

// Health
app.get("/", (c) =>
  c.json({
    success: true,
    service: "Tongji-Walkthrough Editor Backend",
    version: "2.0.0",
  }),
);

// ── GET /api/content ───────────────────────────────────────────────────

app.get("/api/content", async (c) => {
  const path = c.req.query("path");
  const ref = c.req.query("ref") || c.env.GITHUB_BRANCH;
  if (!path) return c.json({ success: false, error: "Missing path" }, 400);
  if (path.includes(".."))
    return c.json({ success: false, error: "Invalid path" }, 400);

  try {
    const r = await gh.getFileContent(c.env, path, ref);
    if (!r) return c.json({ success: false, error: "File not found" }, 404);
    return c.json({ success: true, path, content: r.content, sha: r.sha });
  } catch (e: unknown) {
    return c.json({ success: false, error: (e as Error).message }, 500);
  }
});

// ── POST /api/upload ───────────────────────────────────────────────────

app.post("/api/upload", async (c) => {
  const fd = await c.req.formData();
  const file = fd.get("image") as File | null;
  if (!file) return c.json({ success: false, error: "No image uploaded" }, 400);

  const allowedMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (!allowedMimes.includes(file.type)) {
    return c.json({ success: false, error: "Invalid image type" }, 400);
  }
  if (file.size > 5 * 1024 * 1024) {
    return c.json({ success: false, error: "File too large (max 5MB)" }, 400);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const allowedExts = ["jpg", "jpeg", "png", "gif", "webp"];
  if (!allowedExts.includes(ext)) {
    return c.json({ success: false, error: "Invalid file extension" }, 400);
  }

  // Unique filename: time_hash(random32).ext
  const uniqueName = `upload_${Date.now().toString(16)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}.${ext}`;

  // Store in R2
  const buf = await file.arrayBuffer();
  await c.env.IMAGES_BUCKET.put(`images/${uniqueName}`, buf, {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name },
  });

  // If pr_number provided, write to GitHub branch
  const prRaw = fd.get("pr_number");
  const prNumber = prRaw ? parseInt(prRaw as string, 10) : undefined;
  const email = (fd.get("email") as string) || undefined;
  let branchCommitted = false;

  if (prNumber) {
    const pr = await getPR(c.env, prNumber);
    if (pr && pr.prStatus === "open") {
      try {
        await gh.uploadImageToBranch(
          c.env,
          pr.branchName,
          `public/images/${uniqueName}`,
          buf,
        );
        branchCommitted = true;
      } catch {
        /* non-blocking */
      }
    }
  }

  // Record in KV
  await setImg(c.env, uniqueName, {
    filename: uniqueName,
    originalName: file.name,
    prNumber,
    branchCommitted,
    fileSize: file.size,
    mimeType: file.type,
    uploaderEmail: email,
    createdAt: new Date().toISOString(),
  });

  const imageUrl = `${c.env.BASE_URL}/api/image?id=${encodeURIComponent(uniqueName)}`;
  const title = file.name.replace(/\.[^.]+$/, "");

  return c.json({
    success: true,
    filename: uniqueName,
    path: `public/images/${uniqueName}`,
    url: imageUrl,
    markdown: `![${title}](${imageUrl})`,
    fileSize: file.size,
  });
});

// ── GET /api/image ─────────────────────────────────────────────────────

app.get("/api/image", async (c) => {
  const id = c.req.query("id") || "";
  if (!id || /[^a-zA-Z0-9._-]/.test(id)) {
    return c.json({ success: false, error: "Invalid image id" }, 400);
  }

  const obj = await c.env.IMAGES_BUCKET.get(`images/${id}`);
  if (!obj) return c.json({ success: false, error: "Image not found" }, 404);

  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=31536000",
      "X-Source": "r2",
    },
  });
});

// ── PR Creation Helper (shared by draft & submit) ──────────────────────

async function createPR(
  env: Env,
  profile: {
    studentId: string;
    name: string;
    email: string;
    qq?: string;
    github?: string;
  },
  changes: {
    modified?: Record<string, string>;
    created?: Record<string, string>;
    deleted?: string[];
    images?: (string | { local_filename: string })[];
  },
  isDraft: boolean,
): Promise<{ prNumber: number; prUrl: string; branch: string }> {
  // Branch name
  let sn = profile.name.replace(/ /g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!sn) sn = "user";
  const ts = new Date()
    .toISOString()
    .replace(/[:.Z-]/g, "")
    .slice(0, 15);
  const branch = `edit/${sn}/${ts}`;

  // Create branch from main
  await gh.createBranch(env, branch);

  // Write files to branch
  await gh.writeFilesToBranch(
    env,
    branch,
    changes.modified || {},
    changes.created || {},
    changes.deleted || [],
  );

  // Copy images from R2 to branch
  for (const img of changes.images || []) {
    const fn =
      typeof img === "string"
        ? img
        : (img as { local_filename: string }).local_filename;
    if (!fn) continue;
    const obj = await env.IMAGES_BUCKET.get(`images/${fn}`);
    if (obj) {
      try {
        const buf = await obj.arrayBuffer();
        await gh.uploadImageToBranch(env, branch, `public/images/${fn}`, buf);
      } catch {
        /* non-blocking */
      }
    }
  }

  // PR title & body
  const mc = Object.keys(changes.modified || {}).length;
  const cc = Object.keys(changes.created || {}).length;
  const dc = (changes.deleted || []).length;
  const ic = (changes.images || []).length;

  const prefix = isDraft ? "[暂存]" : "[编辑]";
  const parts: string[] = [];
  if (mc > 0) parts.push(`修改 ${mc} 个文档`);
  if (cc > 0) parts.push(`新增 ${cc} 个文档`);
  if (dc > 0) parts.push(`删除 ${dc} 个文档`);
  if (ic > 0) parts.push(`新增 ${ic} 张图片`);

  const title = `${prefix} ${profile.name} - ${parts.join("，")}`;
  const body =
    `由 Tongji-Walkthrough 编辑平台${isDraft ? " (暂存)" : ""}提交\n\n` +
    `## 提交者信息\n` +
    `- **学号**: ${profile.studentId}\n` +
    `- **姓名**: ${profile.name}\n` +
    `- **邮箱**: ${profile.email}\n` +
    (profile.qq ? `- **QQ**: ${profile.qq}\n` : "") +
    (profile.github ? `- **GitHub**: @${profile.github}\n` : "") +
    `\n## 变更摘要\n` +
    `- 修改文件: ${mc} 个\n- 新增文件: ${cc} 个\n- 删除文件: ${dc} 个\n- 新增图片: ${ic} 个\n` +
    (isDraft
      ? `\n> 此 PR 为暂存版本 (Draft)。提交者后续可通过编辑平台继续更新内容。\n`
      : "\n---\n") +
    `_此 PR 通过 Tongji-Walkthrough 编辑器自动生成_`;

  const pr = await gh.createPR(env, title, body, branch, isDraft);

  // Store mapping in KV
  const now = new Date().toISOString();
  await setPR(env, pr.number, {
    prNumber: pr.number,
    branchName: branch,
    prType: isDraft ? "draft" : "ready",
    prStatus: "open",
    studentId: profile.studentId,
    submitterName: profile.name,
    submitterEmail: profile.email,
    submitterQQ: profile.qq,
    submitterGitHub: profile.github,
    createdAt: now,
    updatedAt: now,
  });

  // Update image PR associations
  for (const img of changes.images || []) {
    const fn =
      typeof img === "string"
        ? img
        : (img as { local_filename: string }).local_filename;
    if (!fn) continue;
    const rec = await getImg(env, fn);
    if (rec) {
      rec.prNumber = pr.number;
      rec.branchCommitted = true;
      await setImg(env, fn, rec);
    }
  }

  return { prNumber: pr.number, prUrl: pr.html_url, branch };
}

// ── POST /api/draft ────────────────────────────────────────────────────

app.post("/api/draft", async (c) => {
  const body = await c.req.json<SubmitRequest>();
  const { profile, changes } = body;

  if (!profile || !changes)
    return c.json({ success: false, error: "Missing profile or changes" }, 400);

  const errs: string[] = [];
  if (!profile.studentId) errs.push("Missing studentId");
  if (!profile.name) errs.push("Missing name");
  if (!profile.email) errs.push("Missing email");
  if (!profile.qq && !profile.github)
    errs.push("Either qq or github is required");
  if (errs.length)
    return c.json(
      { success: false, error: "Validation failed", details: errs },
      400,
    );

  try {
    const r = await createPR(c.env, profile, changes, true);
    return c.json({
      success: true,
      prNumber: r.prNumber,
      prUrl: r.prUrl,
      prType: "draft",
      branch: r.branch,
    });
  } catch (e: unknown) {
    return c.json({ success: false, error: (e as Error).message }, 502);
  }
});

// ── POST /api/submit ───────────────────────────────────────────────────

app.post("/api/submit", async (c) => {
  const body = await c.req.json<SubmitRequest>();
  const { profile, changes } = body;
  if (!profile || !changes)
    return c.json({ success: false, error: "Missing profile or changes" }, 400);

  const errs: string[] = [];
  if (!profile.studentId) errs.push("Missing studentId");
  if (!profile.name) errs.push("Missing name");
  if (!profile.email) errs.push("Missing email");
  if (!profile.qq && !profile.github)
    errs.push("Either qq or github is required");
  if (errs.length)
    return c.json(
      { success: false, error: "Validation failed", details: errs },
      400,
    );

  try {
    const r = await createPR(c.env, profile, changes, false);
    return c.json({
      success: true,
      prNumber: r.prNumber,
      prUrl: r.prUrl,
      prType: "ready",
      branch: r.branch,
    });
  } catch (e: unknown) {
    return c.json({ success: false, error: (e as Error).message }, 502);
  }
});

// ── POST /api/update ───────────────────────────────────────────────────

app.post("/api/update", async (c) => {
  const body = (await c.req.json()) as {
    prNumber: number;
    promote?: boolean;
    profile?: { email: string };
    changes: {
      modified?: Record<string, string>;
      created?: Record<string, string>;
      deleted?: string[];
      images?: (string | { local_filename: string })[];
    };
  };

  if (!body.prNumber || !body.changes) {
    return c.json(
      { success: false, error: "Missing pr_number or changes" },
      400,
    );
  }

  const mapping = await getPR(c.env, body.prNumber);
  if (!mapping)
    return c.json({ success: false, error: "PR not found in database" }, 404);

  // 必须传 email 且匹配提交者
  if (!body.profile?.email) {
    return c.json({ success: false, error: "Email required" }, 400);
  }
  if (body.profile.email !== mapping.submitterEmail) {
    return c.json({ success: false, error: "Email mismatch" }, 403);
  }

  // Check PR state
  try {
    const pr = await gh.getPR(c.env, body.prNumber);
    if (pr.state !== "open") {
      return c.json(
        { success: false, error: `PR is not open (state: ${pr.state})` },
        409,
      );
    }
  } catch (e: unknown) {
    return c.json(
      { success: false, error: "Failed to check PR: " + (e as Error).message },
      502,
    );
  }

  // Write files to existing branch
  try {
    await gh.writeFilesToBranch(
      c.env,
      mapping.branchName,
      body.changes.modified || {},
      body.changes.created || {},
      body.changes.deleted || [],
    );

    // Handle images from R2
    for (const img of body.changes.images || []) {
      const fn =
        typeof img === "string"
          ? img
          : (img as { local_filename: string }).local_filename;
      if (!fn) continue;
      const obj = await c.env.IMAGES_BUCKET.get(`images/${fn}`);
      if (obj) {
        try {
          const buf = await obj.arrayBuffer();
          await gh.uploadImageToBranch(
            c.env,
            mapping.branchName,
            `public/images/${fn}`,
            buf,
          );
        } catch {
          /* non-blocking */
        }
      }
      const rec = await getImg(c.env, fn);
      if (rec) {
        rec.prNumber = body.prNumber;
        rec.branchCommitted = true;
        await setImg(c.env, fn, rec);
      }
    }
  } catch (e: unknown) {
    return c.json(
      { success: false, error: "File commit failed: " + (e as Error).message },
      502,
    );
  }

  // Promote if requested
  let converted = false;
  if (body.promote && mapping.prType === "draft") {
    try {
      await gh.markPRReady(c.env, body.prNumber);
      converted = true;
      mapping.prType = "ready";
      mapping.updatedAt = new Date().toISOString();
      await setPR(c.env, body.prNumber, mapping);
    } catch {
      /* non-blocking */
    }
  }

  return c.json({
    success: true,
    prNumber: body.prNumber,
    branch: mapping.branchName,
    converted,
    prType: converted ? "ready" : mapping.prType,
  });
});

// ── GET /api/pr-status ─────────────────────────────────────────────────

app.get("/api/pr-status", async (c) => {
  const pn = parseInt(c.req.query("pr_number") || "0", 10);
  if (!pn) return c.json({ success: false, error: "Invalid pr_number" }, 400);

  const local = await getPR(c.env, pn);

  try {
    const pr = await gh.getPR(c.env, pn);
    let ls = "open";
    if (pr.merged) ls = "merged";
    else if (pr.state === "closed") ls = "closed";

    if (local && ls !== local.prStatus) {
      local.prStatus = ls as PRMapping["prStatus"];
      local.updatedAt = new Date().toISOString();
      await setPR(c.env, pn, local);
    }

    return c.json({
      success: true,
      prNumber: pn,
      state: pr.state,
      merged: pr.merged,
      draft: pr.draft,
      title: pr.title,
      pr_url: pr.html_url,
      created_at: pr.created_at,
      updated_at: pr.updated_at,
      local: local
        ? {
            prType: local.prType,
            prStatus: local.prStatus,
            name: local.submitterName,
          }
        : null,
    });
  } catch {
    return c.json({ success: false, error: "PR not found on GitHub" }, 404);
  }
});

// ── GET /api/history ───────────────────────────────────────────────────

app.get("/api/history", async (c) => {
  const email = c.req.query("email");
  const studentId = c.req.query("student_id");
  if (!email && !studentId)
    return c.json(
      { success: false, error: "Missing email or student_id" },
      400,
    );

  const records: PRMapping[] = [];
  let cursor: string | undefined;

  do {
    const result = await c.env.EDITOR_KV.list({ prefix: KV_PR, cursor });
    for (const key of result.keys) {
      const m = (await c.env.EDITOR_KV.get(
        key.name,
        "json",
      )) as PRMapping | null;
      if (!m) continue;
      if (
        (email && m.submitterEmail === email) ||
        (studentId && m.studentId === studentId)
      ) {
        try {
          const pr = await gh.getPR(c.env, m.prNumber);
          if (pr.merged) m.prStatus = "merged";
          else if (pr.state === "closed") m.prStatus = "closed";
          else m.prStatus = "open";
        } catch {
          /* ignore */
        }
        records.push(m);
      }
    }
    cursor = result.cursor;
  } while (cursor);

  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return c.json({ success: true, records: records.slice(0, 50) });
});

// ── GET /api/cleanup (also from CRON) ──────────────────────────────────

const CLEANUP_CUTOFF_MS = 24 * 60 * 60 * 1000;

async function runCleanup(
  env: Env,
): Promise<{ files: number; records: number }> {
  const cutoff = new Date(Date.now() - CLEANUP_CUTOFF_MS).toISOString();
  let files = 0;
  let records = 0;
  let cursor: string | undefined;

  do {
    const result = await env.EDITOR_KV.list({ prefix: KV_IMG, cursor });
    for (const key of result.keys) {
      const rec = (await env.EDITOR_KV.get(
        key.name,
        "json",
      )) as ImageRecord | null;
      if (rec && !rec.prNumber && rec.createdAt < cutoff) {
        await env.IMAGES_BUCKET.delete(`images/${rec.filename}`);
        await env.EDITOR_KV.delete(key.name);
        files++;
        records++;
      }
    }
    cursor = result.cursor;
  } while (cursor);

  return { files, records };
}

app.get("/api/cleanup", async (c) => {
  const cleaned = await runCleanup(c.env);
  const cutoff = new Date(Date.now() - CLEANUP_CUTOFF_MS).toISOString();
  return c.json({ success: true, cleaned, cutoff });
});

// ── CRON Scheduler ─────────────────────────────────────────────────────

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCleanup(env));
  },
};
