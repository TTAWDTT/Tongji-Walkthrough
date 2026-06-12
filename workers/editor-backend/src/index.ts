import type { Context } from "hono";
import type {
  Env,
  PRMapping,
  ImageRecord,
  Profile,
  SubmitRequest,
  UpdateRequest,
  DiscardRequest,
  Changes,
} from "./types";

import { Hono } from "hono";
import { cors } from "hono/cors";

import * as gh from "./github";

type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = c.env.ALLOWED_ORIGINS.split(",").map((s: string) =>
        s.trim().toLowerCase(),
      );

      if (allowed.includes("*")) return origin;

      return allowed.includes(origin.toLowerCase()) ? origin : null;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

// ---- KV helpers ----

const KV_PR = "pr:";
const KV_IMG = "img:";

async function getPRMapping(env: Env, n: number): Promise<PRMapping | null> {
  return (await env.EDITOR_KV.get(`${KV_PR}${n}`, "json")) as PRMapping | null;
}
async function setPRMapping(env: Env, n: number, m: PRMapping): Promise<void> {
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

// ---- Rate limiting（KV 固定窗口，按 IP） ----

async function rateLimit(
  c: AppContext,
  bucket: string,
  limit: number,
  windowSec = 3600,
): Promise<Response | null> {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${bucket}:${ip}:${window}`;
  const count = parseInt((await c.env.EDITOR_KV.get(key)) ?? "0", 10);

  if (count >= limit) {
    return c.json({ success: false, error: "请求过于频繁，请稍后再试" }, 429);
  }
  await c.env.EDITOR_KV.put(key, String(count + 1), {
    expirationTtl: windowSec + 60,
  });

  return null;
}

// ---- Validation ----

const IMAGE_NAME_RE = /^[A-Za-z0-9._-]+$/;
// 仅允许写入文档目录下的 .md / _meta.json
const DOC_PATH_RE =
  /^content\/docs\/(?:[\w一-鿿.-]+\/)*(?:[\w一-鿿.-]+\.md|_meta\.json)$/;

function isValidDocPath(path: string): boolean {
  if (path.includes("..") || path.includes("//")) return false;

  return DOC_PATH_RE.test(path);
}

function isValidImageName(name: string): boolean {
  return IMAGE_NAME_RE.test(name) && !name.includes("..");
}

function validateProfile(profile?: Profile): string[] {
  const errs: string[] = [];

  if (!profile?.studentId) errs.push("Missing studentId");
  if (!profile?.name) errs.push("Missing name");
  if (!profile?.email) errs.push("Missing email");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
    errs.push("Invalid email");
  }
  if (!profile?.qq && !profile?.github) {
    errs.push("Either qq or github is required");
  }

  return errs;
}

function validateChangePaths(changes: Changes): string | null {
  for (const path of [
    ...Object.keys(changes.modified ?? {}),
    ...Object.keys(changes.created ?? {}),
    ...(changes.deleted ?? []),
  ]) {
    if (!isValidDocPath(path)) return `Invalid path: ${path}`;
  }
  for (const img of changes.images ?? []) {
    if (typeof img !== "string" || !isValidImageName(img)) {
      return `Invalid image name`;
    }
  }

  return null;
}

function hasDeclaredChanges(changes: Changes): boolean {
  return (
    Object.keys(changes.modified ?? {}).length > 0 ||
    Object.keys(changes.created ?? {}).length > 0 ||
    (changes.deleted ?? []).length > 0 ||
    (changes.images ?? []).length > 0
  );
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ---- Change-set → 单 commit 的写入集合 ----

async function collectWrites(
  env: Env,
  changes: Changes,
): Promise<{ writes: gh.FileWrite[]; deletes: string[]; images: string[] }> {
  const writes: gh.FileWrite[] = [];
  const images: string[] = [];

  for (const [path, text] of Object.entries(changes.modified ?? {})) {
    writes.push({ path, text });
  }
  for (const [path, text] of Object.entries(changes.created ?? {})) {
    writes.push({ path, text });
  }
  for (const filename of changes.images ?? []) {
    const obj = await env.IMAGES_BUCKET.get(`images/${filename}`);

    if (!obj) continue;
    writes.push({
      path: `public/images/${filename}`,
      bytes: await obj.arrayBuffer(),
    });
    images.push(filename);
  }

  return { writes, deletes: changes.deleted ?? [], images };
}

async function syncImageRecords(
  env: Env,
  imageNames: string[],
  prNumber: number,
  writtenPaths: string[],
): Promise<void> {
  for (const filename of imageNames) {
    const rec = await getImg(env, filename);

    if (!rec) continue;
    rec.prNumber = prNumber;
    rec.branchCommitted = writtenPaths.includes(`public/images/${filename}`);
    await setImg(env, filename, rec);
  }
}

// ---- Routes ----

app.get("/", (c) =>
  c.json({
    success: true,
    service: "Tongji-Walkthrough Editor Backend",
    version: "2.1.0",
  }),
);

app.get("/api/content", async (c) => {
  const path = c.req.query("path");
  const ref = c.req.query("ref") || c.env.GITHUB_BRANCH;

  if (!path) return c.json({ success: false, error: "Missing path" }, 400);
  if (!isValidDocPath(path)) {
    return c.json({ success: false, error: "Invalid path" }, 400);
  }
  try {
    const r = await gh.getFileContent(c.env, path, ref);

    if (!r) return c.json({ success: false, error: "File not found" }, 404);

    return c.json({ success: true, path, content: r.content, sha: r.sha });
  } catch (e: unknown) {
    return c.json({ success: false, error: (e as Error).message }, 502);
  }
});

// 列出 main 分支上的文档文件，供编辑器对齐最新基线
app.get("/api/docs", async (c) => {
  const limited = await rateLimit(c, "read", 120);

  if (limited) return limited;
  try {
    const { files } = await gh.listTree(c.env, c.env.GITHUB_BRANCH);
    const docs: { path: string; sha: string }[] = [];

    for (const [path, sha] of files) {
      if (
        path.startsWith("content/docs/") &&
        (path.endsWith(".md") || path.endsWith("/_meta.json"))
      ) {
        docs.push({ path, sha });
      }
    }

    return c.json({
      success: true,
      branch: c.env.GITHUB_BRANCH,
      rawBase: `https://raw.githubusercontent.com/${c.env.GITHUB_OWNER}/${c.env.GITHUB_REPO}/${c.env.GITHUB_BRANCH}`,
      files: docs,
    });
  } catch (e: unknown) {
    return c.json({ success: false, error: (e as Error).message }, 502);
  }
});

app.post("/api/upload", async (c) => {
  const limited = await rateLimit(c, "upload", 20);

  if (limited) return limited;

  const fd = await c.req.formData();
  const file = fd.get("image");

  if (!(file instanceof File)) {
    return c.json({ success: false, error: "No image uploaded" }, 400);
  }
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

  const prRaw = fd.get("pr_number");
  const email =
    typeof fd.get("email") === "string" ? String(fd.get("email")) : undefined;
  const prNumber = typeof prRaw === "string" ? parseInt(prRaw, 10) : NaN;
  let mapping: PRMapping | null = null;

  // 关联 PR 时必须证明归属（email 与 PR 创建者一致），防止向他人 PR 写入
  if (Number.isFinite(prNumber) && prNumber > 0) {
    mapping = await getPRMapping(c.env, prNumber);
    if (!mapping) {
      return c.json({ success: false, error: "PR not found" }, 404);
    }
    if (!email || email !== mapping.submitterEmail) {
      return c.json({ success: false, error: "Email mismatch" }, 403);
    }
  }

  const buf = await file.arrayBuffer();
  const contentHash = await sha256Hex(buf);
  const uniqueName = `upload_${Date.now()}_${contentHash.slice(0, 32)}.${ext}`;

  await c.env.IMAGES_BUCKET.put(`images/${uniqueName}`, buf, {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name },
  });

  let branchCommitted = false;

  if (mapping && mapping.prStatus === "open") {
    try {
      const result = await gh.commitToBranch(
        c.env,
        mapping.branchName,
        [{ path: `public/images/${uniqueName}`, bytes: buf }],
        [],
        `Upload image: ${uniqueName}`,
      );

      branchCommitted = result.written.includes(`public/images/${uniqueName}`);
    } catch {
      /* 上传到分支失败不阻塞；提交时会随 change-set 重试 */
    }
  }

  await setImg(c.env, uniqueName, {
    filename: uniqueName,
    originalName: file.name,
    prNumber: mapping ? prNumber : undefined,
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

app.get("/api/image", async (c) => {
  const id = c.req.query("id") || "";

  if (!id || !isValidImageName(id)) {
    return c.json({ success: false, error: "Invalid image id" }, 400);
  }
  const obj = await c.env.IMAGES_BUCKET.get(`images/${id}`);

  if (obj) {
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || "image/jpeg",
        "Cache-Control": "public, max-age=31536000",
        "X-Source": "r2",
      },
    });
  }

  // R2 没有时回源 GitHub：优先关联 PR 的分支，再回退默认分支
  const refs: string[] = [];
  const rec = await getImg(c.env, id);

  if (rec?.prNumber && rec.branchCommitted) {
    const mapping = await getPRMapping(c.env, rec.prNumber);

    if (mapping && mapping.prStatus === "open") refs.push(mapping.branchName);
  }
  refs.push(c.env.GITHUB_BRANCH);

  for (const ref of refs) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${c.env.GITHUB_OWNER}/${c.env.GITHUB_REPO}/${ref}/public/images/${id}`;
      const ghResp = await fetch(rawUrl);

      if (ghResp.ok) {
        return new Response(await ghResp.arrayBuffer(), {
          headers: {
            "Content-Type": ghResp.headers.get("content-type") || "image/jpeg",
            "Cache-Control": "public, max-age=31536000",
            "X-Source": "github-raw",
          },
        });
      }
    } catch {
      /* try next ref */
    }
  }

  return c.json({ success: false, error: "Image not found" }, 404);
});

// ---- PR 创建（draft / ready 共用） ----

async function createPRFlow(
  env: Env,
  profile: Profile,
  changes: Changes,
  isDraft: boolean,
): Promise<{ prNumber: number; prUrl: string; branch: string }> {
  let sn = profile.name.replace(/ /g, "_").replace(/[^a-zA-Z0-9_-]/g, "");

  if (!sn) sn = "user";
  const ts = new Date()
    .toISOString()
    .replace(/[:.Z-]/g, "")
    .slice(0, 15);
  const rand = crypto.randomUUID().slice(0, 4);
  const branch = `edit/${sn}/${ts}-${rand}`;

  await gh.createBranch(env, branch);

  const { writes, deletes, images } = await collectWrites(env, changes);
  let result: gh.CommitResult;

  try {
    result = await gh.commitToBranch(
      env,
      branch,
      writes,
      deletes,
      `[编辑器] ${profile.name} 提交内容更新`,
    );
  } catch (e) {
    // 提交失败时清理刚建的分支，避免累积孤儿分支
    await gh.deleteBranch(env, branch).catch(() => undefined);
    throw e;
  }

  if (!result.committed) {
    await gh.deleteBranch(env, branch).catch(() => undefined);
    throw new Error("未检测到任何有效改动（内容与线上版本一致）");
  }

  const mc = Object.keys(changes.modified ?? {}).length;
  const cc = Object.keys(changes.created ?? {}).length;
  const dc = (changes.deleted ?? []).length;
  const ic = images.length;
  const prefix = isDraft ? "[暂存]" : "[编辑]";
  const parts: string[] = [];

  if (mc > 0) parts.push(`修改 ${mc} 个文档`);
  if (cc > 0) parts.push(`新增 ${cc} 个文档`);
  if (dc > 0) parts.push(`删除 ${dc} 个文档`);
  if (ic > 0) parts.push(`新增 ${ic} 张图片`);
  const title = `${prefix} ${profile.name} - ${parts.join("，") || "内容更新"}`;
  const body =
    `由 Tongji-Walkthrough 编辑平台${isDraft ? " (暂存)" : ""}提交\n\n## 提交者信息\n- **学号**: ${profile.studentId}\n- **姓名**: ${profile.name}\n- **邮箱**: ${profile.email}\n` +
    (profile.qq ? `- **QQ**: ${profile.qq}\n` : "") +
    (profile.github ? `- **GitHub**: @${profile.github}\n` : "") +
    `\n## 变更摘要\n- 修改文件: ${mc} 个\n- 新增文件: ${cc} 个\n- 删除文件: ${dc} 个\n- 新增图片: ${ic} 个\n` +
    (isDraft ? `\n> 此 PR 为暂存版本 (Draft)。\n` : "\n---\n") +
    `_此 PR 通过 Tongji-Walkthrough 编辑器自动生成_`;

  let pr: gh.PRInfo;

  try {
    pr = await gh.createPR(env, title, body, branch, isDraft);
  } catch (e) {
    await gh.deleteBranch(env, branch).catch(() => undefined);
    throw e;
  }
  const now = new Date().toISOString();

  await setPRMapping(env, pr.number, {
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
  await syncImageRecords(env, images, pr.number, result.written);

  return { prNumber: pr.number, prUrl: pr.html_url, branch };
}

async function handleCreate(c: AppContext, isDraft: boolean) {
  const limited = await rateLimit(c, "create", 5);

  if (limited) return limited;

  let body: SubmitRequest;

  try {
    body = await c.req.json<SubmitRequest>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }
  const { profile, changes } = body;

  if (!profile || !changes) {
    return c.json({ success: false, error: "Missing profile or changes" }, 400);
  }
  const errs = validateProfile(profile);

  if (errs.length) {
    return c.json(
      { success: false, error: "Validation failed", details: errs },
      400,
    );
  }
  if (!hasDeclaredChanges(changes)) {
    return c.json({ success: false, error: "没有检测到任何改动" }, 400);
  }
  const pathError = validateChangePaths(changes);

  if (pathError) {
    return c.json({ success: false, error: pathError }, 400);
  }

  try {
    const r = await createPRFlow(c.env, profile, changes, isDraft);

    return c.json({
      success: true,
      prNumber: r.prNumber,
      prUrl: r.prUrl,
      prType: isDraft ? "draft" : "ready",
      branch: r.branch,
    });
  } catch (e: unknown) {
    return c.json({ success: false, error: (e as Error).message }, 502);
  }
}

app.post("/api/draft", (c) => handleCreate(c, true));
app.post("/api/submit", (c) => handleCreate(c, false));

app.post("/api/update", async (c) => {
  const limited = await rateLimit(c, "update", 30);

  if (limited) return limited;

  let body: UpdateRequest;

  try {
    body = await c.req.json<UpdateRequest>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }
  if (!body.prNumber) {
    return c.json({ success: false, error: "Missing prNumber" }, 400);
  }
  const changes: Changes = body.changes ?? {};
  const mapping = await getPRMapping(c.env, body.prNumber);

  if (!mapping) {
    return c.json({ success: false, error: "PR not found in database" }, 404);
  }
  if (!body.profile?.email) {
    return c.json({ success: false, error: "Email required" }, 400);
  }
  if (body.profile.email !== mapping.submitterEmail) {
    return c.json({ success: false, error: "Email mismatch" }, 403);
  }
  const pathError = validateChangePaths(changes);

  if (pathError) {
    return c.json({ success: false, error: pathError }, 400);
  }

  let pr: gh.PRInfo;

  try {
    pr = await gh.getPR(c.env, body.prNumber);
  } catch (e: unknown) {
    return c.json(
      { success: false, error: "Failed to check PR: " + (e as Error).message },
      502,
    );
  }
  if (pr.state !== "open") {
    return c.json(
      { success: false, error: `PR is not open (state: ${pr.state})` },
      409,
    );
  }

  try {
    const { writes, deletes, images } = await collectWrites(c.env, changes);
    const result = await gh.commitToBranch(
      c.env,
      mapping.branchName,
      writes,
      deletes,
      `[编辑器] ${mapping.submitterName} 更新内容`,
      { baseRef: c.env.GITHUB_BRANCH },
    );

    await syncImageRecords(c.env, images, body.prNumber, result.written);
  } catch (e: unknown) {
    return c.json(
      { success: false, error: "File commit failed: " + (e as Error).message },
      502,
    );
  }

  let converted = false;
  let promoteFailed = false;

  if (body.promote && mapping.prType === "draft" && pr.draft) {
    try {
      await gh.markPRReady(c.env, pr.node_id);
      converted = true;
    } catch {
      promoteFailed = true;
    }
  } else if (body.promote && !pr.draft) {
    converted = true; // 已经是 ready 状态
  }

  if (converted) mapping.prType = "ready";
  mapping.updatedAt = new Date().toISOString();
  await setPRMapping(c.env, body.prNumber, mapping);

  return c.json({
    success: true,
    prNumber: body.prNumber,
    prUrl: pr.html_url,
    branch: mapping.branchName,
    converted,
    promoteFailed,
    prType: mapping.prType,
  });
});

// 读取 PR 分支相对 main 的全部变更，用于恢复草稿
app.get("/api/pr-changes", async (c) => {
  const limited = await rateLimit(c, "read", 120);

  if (limited) return limited;

  const prNumber = parseInt(c.req.query("pr_number") || "0", 10);
  const email = c.req.query("email") || "";

  if (!prNumber) {
    return c.json({ success: false, error: "Invalid pr_number" }, 400);
  }
  const mapping = await getPRMapping(c.env, prNumber);

  if (!mapping) {
    return c.json({ success: false, error: "PR not found in database" }, 404);
  }
  if (!email || email !== mapping.submitterEmail) {
    return c.json({ success: false, error: "Email mismatch" }, 403);
  }

  let pr: gh.PRInfo;

  try {
    pr = await gh.getPR(c.env, prNumber);
  } catch {
    return c.json({ success: false, error: "PR not found on GitHub" }, 404);
  }
  if (pr.state !== "open") {
    const status = pr.merged ? "merged" : "closed";

    if (mapping.prStatus !== status) {
      mapping.prStatus = status;
      mapping.updatedAt = new Date().toISOString();
      await setPRMapping(c.env, prNumber, mapping);
    }

    return c.json(
      { success: false, error: `PR is not open (state: ${status})` },
      409,
    );
  }

  try {
    const compared = await gh.compareBranches(
      c.env,
      c.env.GITHUB_BRANCH,
      mapping.branchName,
    );
    const docFiles = compared.filter((f) =>
      f.filename.startsWith("content/docs/"),
    );
    const images = compared
      .filter(
        (f) =>
          f.filename.startsWith("public/images/") && f.status !== "removed",
      )
      .map((f) => f.filename.slice("public/images/".length));

    // 子请求预算：每个文件需单独拉取内容
    if (docFiles.length > 40) {
      return c.json(
        { success: false, error: "草稿改动过多，无法在线恢复" },
        413,
      );
    }

    const files: {
      path: string;
      status: string;
      previousPath?: string;
      content?: string;
    }[] = [];

    for (const f of docFiles) {
      if (f.status === "removed") {
        files.push({ path: f.filename, status: "removed" });
        continue;
      }
      const content = await gh.getFileContent(
        c.env,
        f.filename,
        mapping.branchName,
      );

      files.push({
        path: f.filename,
        status: f.status === "renamed" ? "renamed" : f.status,
        previousPath: f.previous_filename,
        content: content?.content,
      });
    }

    return c.json({
      success: true,
      prNumber,
      prType: pr.draft ? "draft" : "ready",
      branch: mapping.branchName,
      files,
      images,
    });
  } catch (e: unknown) {
    return c.json({ success: false, error: (e as Error).message }, 502);
  }
});

// 放弃暂存：关闭 PR 并删除分支
app.post("/api/discard", async (c) => {
  const limited = await rateLimit(c, "discard", 10);

  if (limited) return limited;

  let body: DiscardRequest;

  try {
    body = await c.req.json<DiscardRequest>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }
  if (!body.prNumber) {
    return c.json({ success: false, error: "Missing prNumber" }, 400);
  }
  const mapping = await getPRMapping(c.env, body.prNumber);

  if (!mapping) {
    return c.json({ success: false, error: "PR not found in database" }, 404);
  }
  if (!body.profile?.email || body.profile.email !== mapping.submitterEmail) {
    return c.json({ success: false, error: "Email mismatch" }, 403);
  }

  try {
    const pr = await gh.getPR(c.env, body.prNumber);

    if (pr.state === "open") {
      await gh.closePR(c.env, body.prNumber);
      await gh.deleteBranch(c.env, mapping.branchName).catch(() => undefined);
      mapping.prStatus = "closed";
    } else {
      mapping.prStatus = pr.merged ? "merged" : "closed";
    }
    mapping.updatedAt = new Date().toISOString();
    await setPRMapping(c.env, body.prNumber, mapping);

    return c.json({ success: true, prNumber: body.prNumber });
  } catch (e: unknown) {
    return c.json({ success: false, error: (e as Error).message }, 502);
  }
});

app.get("/api/pr-status", async (c) => {
  const pn = parseInt(c.req.query("pr_number") || "0", 10);

  if (!pn) return c.json({ success: false, error: "Invalid pr_number" }, 400);
  const local = await getPRMapping(c.env, pn);

  try {
    const pr = await gh.getPR(c.env, pn);
    let ls: PRMapping["prStatus"] = "open";

    if (pr.merged) ls = "merged";
    else if (pr.state === "closed") ls = "closed";
    if (local && ls !== local.prStatus) {
      local.prStatus = ls;
      local.updatedAt = new Date().toISOString();
      await setPRMapping(c.env, pn, local);
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
      local: local ? { prType: local.prType, prStatus: local.prStatus } : null,
    });
  } catch {
    return c.json({ success: false, error: "PR not found on GitHub" }, 404);
  }
});

// 历史查询：只返回非敏感字段，不回显个人信息
app.get("/api/history", async (c) => {
  const limited = await rateLimit(c, "read", 120);

  if (limited) return limited;

  const email = c.req.query("email");
  const studentId = c.req.query("student_id");

  if (!email && !studentId) {
    return c.json(
      { success: false, error: "Missing email or student_id" },
      400,
    );
  }
  const records: {
    prNumber: number;
    prType: string;
    prStatus: string;
    prUrl: string;
    createdAt: string;
    updatedAt: string;
  }[] = [];
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
        records.push({
          prNumber: m.prNumber,
          prType: m.prType,
          prStatus: m.prStatus,
          prUrl: `https://github.com/${c.env.GITHUB_OWNER}/${c.env.GITHUB_REPO}/pull/${m.prNumber}`,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        });
      }
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return c.json({ success: true, records: records.slice(0, 50) });
});

// ---- 清理 ----

const ORPHAN_CUTOFF_MS = 24 * 60 * 60 * 1000;
const CLOSED_CUTOFF_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PR_LOOKUPS_PER_RUN = 20;

async function runCleanup(
  env: Env,
): Promise<{ files: number; records: number }> {
  const orphanCutoff = new Date(Date.now() - ORPHAN_CUTOFF_MS).toISOString();
  const closedCutoff = new Date(Date.now() - CLOSED_CUTOFF_MS).toISOString();
  let files = 0;
  let records = 0;
  let cursor: string | undefined;
  let prLookups = 0;
  const prCache = new Map<number, PRMapping | null>();

  const resolveMapping = async (
    prNumber: number,
  ): Promise<PRMapping | null> => {
    if (prCache.has(prNumber)) return prCache.get(prNumber) ?? null;
    const mapping = await getPRMapping(env, prNumber);

    // KV 中的状态可能滞后，预算内向 GitHub 核实 open 状态的 PR
    if (
      mapping &&
      mapping.prStatus === "open" &&
      prLookups < MAX_PR_LOOKUPS_PER_RUN
    ) {
      prLookups += 1;
      try {
        const pr = await gh.getPR(env, prNumber);

        if (pr.merged) mapping.prStatus = "merged";
        else if (pr.state === "closed") mapping.prStatus = "closed";
        if (mapping.prStatus !== "open") {
          mapping.updatedAt = new Date().toISOString();
          await setPRMapping(env, prNumber, mapping);
        }
      } catch {
        /* keep stored status */
      }
    }
    prCache.set(prNumber, mapping);

    return mapping;
  };

  do {
    const result = await env.EDITOR_KV.list({ prefix: KV_IMG, cursor });

    for (const key of result.keys) {
      const rec = (await env.EDITOR_KV.get(
        key.name,
        "json",
      )) as ImageRecord | null;

      if (!rec) continue;

      let shouldDelete = false;

      if (!rec.prNumber) {
        // 始终未关联 PR 的孤立图片：24 小时后清理
        shouldDelete = rec.createdAt < orphanCutoff;
      } else {
        const mapping = await resolveMapping(rec.prNumber);

        if (!mapping) {
          shouldDelete = rec.createdAt < orphanCutoff;
        } else if (mapping.prStatus === "merged" && rec.branchCommitted) {
          // 已合并：图片在 main 上，R2 副本可清理（由 GitHub raw 回源兜底）
          shouldDelete = true;
        } else if (mapping.prStatus === "closed") {
          // 已关闭（未合并）：保留 7 天宽限期后清理
          shouldDelete = rec.createdAt < closedCutoff;
        }
      }

      if (shouldDelete) {
        await env.IMAGES_BUCKET.delete(`images/${rec.filename}`);
        await env.EDITOR_KV.delete(key.name);
        files += 1;
        records += 1;
      }
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return { files, records };
}

app.get("/api/cleanup", async (c) => {
  const token = c.req.header("authorization");

  if (!c.env.ADMIN_TOKEN || token !== `Bearer ${c.env.ADMIN_TOKEN}`) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }
  const cleaned = await runCleanup(c.env);

  return c.json({ success: true, cleaned });
});

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runCleanup(env));
  },
};
