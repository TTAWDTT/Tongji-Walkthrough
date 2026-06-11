/**
 * GitHub API 封装
 *
 * 写操作走 Git Data API（blob → tree → commit → ref），一次请求落一个
 * commit：原子、不受逐文件提交的 race 影响，且大幅减少 Worker 子请求数
 * （免费版每请求上限 50 个）。内容与分支上现有 blob 相同的写入会被跳过。
 */
import type { Env } from "./types";

const GITHUB_API = "https://api.github.com";

// ---- base64 helpers（分块处理，避免大文件展开参数导致栈溢出） ----

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }

  return btoa(binary);
}

export function utf8ToBase64(str: string): string {
  return bytesToBase64(new TextEncoder().encode(str));
}

export function base64ToUtf8(encoded: string): string {
  const binary = atob(encoded.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
}

/** git blob SHA-1: sha1("blob <len>\0" + data)，用于跳过无变化的写入。 */
export async function gitBlobSha(data: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${data.length}\0`);
  const buf = new Uint8Array(header.length + data.length);

  buf.set(header, 0);
  buf.set(data, header.length);
  const digest = await crypto.subtle.digest("SHA-1", buf);

  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---- HTTP ----

async function githubApi(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Tongji-Walkthrough-Editor/2.0",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: res.statusText }));

    throw new Error(
      `GitHub API error: ${(data as { message?: string }).message ?? res.statusText}`,
    );
  }

  return res;
}

async function githubGraphql<T>(
  env: Env,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${GITHUB_API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "Tongji-Walkthrough-Editor/2.0",
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = (await res.json()) as {
    data?: T;
    errors?: { message: string }[];
  };

  if (!res.ok || data.errors?.length) {
    throw new Error(
      `GitHub GraphQL error: ${data.errors?.[0]?.message ?? res.statusText}`,
    );
  }

  return data.data as T;
}

// ---- Refs / Branches ----

export async function getRef(
  env: Env,
  ref: string,
): Promise<{ object: { sha: string } }> {
  const res = await githubApi(
    env,
    "GET",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/ref/heads/${ref}`,
  );

  return res.json();
}

export async function createBranch(
  env: Env,
  branchName: string,
): Promise<void> {
  const main = await getRef(env, env.GITHUB_BRANCH);

  await githubApi(
    env,
    "POST",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/refs`,
    { ref: `refs/heads/${branchName}`, sha: main.object.sha },
  );
}

export async function deleteBranch(
  env: Env,
  branchName: string,
): Promise<void> {
  await githubApi(
    env,
    "DELETE",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/refs/heads/${branchName}`,
  );
}

// ---- Contents ----

export async function getFileContent(
  env: Env,
  path: string,
  ref: string,
): Promise<{ content: string; sha: string } | null> {
  try {
    const res = await githubApi(
      env,
      "GET",
      `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`,
    );
    const data = (await res.json()) as { content: string; sha: string };

    return { content: base64ToUtf8(data.content), sha: data.sha };
  } catch {
    return null;
  }
}

// ---- Git Data API：单 commit 写入 ----

export type FileWrite = {
  path: string;
  /** 文本内容（与 bytes 二选一） */
  text?: string;
  /** 二进制内容（与 text 二选一） */
  bytes?: ArrayBuffer;
};

export type CommitResult = {
  committed: boolean;
  /** 实际写入（或内容已在分支上）的路径 */
  written: string[];
};

type TreeEntry = {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string | null;
};

/** 列出某 ref 下的全部文件（path → blob sha）。 */
export async function listTree(
  env: Env,
  ref: string,
): Promise<{ headSha: string; treeSha: string; files: Map<string, string> }> {
  const head = await getRef(env, ref);
  const commitRes = await githubApi(
    env,
    "GET",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/commits/${head.object.sha}`,
  );
  const commit = (await commitRes.json()) as { tree: { sha: string } };
  const treeRes = await githubApi(
    env,
    "GET",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/trees/${commit.tree.sha}?recursive=1`,
  );
  const tree = (await treeRes.json()) as {
    truncated: boolean;
    tree: { path: string; type: string; sha: string }[];
  };
  const files = new Map<string, string>();

  if (tree.truncated) {
    throw new Error("Repository tree is too large to enumerate safely");
  }

  for (const item of tree.tree) {
    if (item.type === "blob") files.set(item.path, item.sha);
  }

  return { headSha: head.object.sha, treeSha: commit.tree.sha, files };
}

/**
 * 把一组写入/删除打成一个 commit 推到分支。内容与分支上相同的写入、
 * 以及分支上不存在的删除会被自动跳过；没有实际变更时不产生 commit。
 */
export async function commitToBranch(
  env: Env,
  branch: string,
  writes: FileWrite[],
  deletes: string[],
  message: string,
): Promise<CommitResult> {
  const { headSha, treeSha, files } = await listTree(env, branch);
  const entries: TreeEntry[] = [];
  const written: string[] = [];

  for (const write of writes) {
    const bytes =
      write.text !== undefined
        ? new TextEncoder().encode(write.text)
        : new Uint8Array(write.bytes ?? new ArrayBuffer(0));
    const sha = await gitBlobSha(bytes);

    written.push(write.path);
    if (files.get(write.path) === sha) continue; // 内容未变化，跳过

    const blobRes = await githubApi(
      env,
      "POST",
      `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/blobs`,
      { content: bytesToBase64(bytes), encoding: "base64" },
    );
    const blob = (await blobRes.json()) as { sha: string };

    entries.push({
      path: write.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  for (const path of deletes) {
    if (!files.has(path)) continue; // 分支上不存在，跳过

    entries.push({ path, mode: "100644", type: "blob", sha: null });
  }

  if (entries.length === 0) return { committed: false, written };

  const treeRes = await githubApi(
    env,
    "POST",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/trees`,
    { base_tree: treeSha, tree: entries },
  );
  const newTree = (await treeRes.json()) as { sha: string };
  const commitRes = await githubApi(
    env,
    "POST",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/commits`,
    { message, tree: newTree.sha, parents: [headSha] },
  );
  const newCommit = (await commitRes.json()) as { sha: string };

  await githubApi(
    env,
    "PATCH",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/refs/heads/${branch}`,
    { sha: newCommit.sha },
  );

  return { committed: true, written };
}

// ---- Compare ----

export type ComparedFile = {
  filename: string;
  status: string;
  previous_filename?: string;
};

export async function compareBranches(
  env: Env,
  base: string,
  head: string,
): Promise<ComparedFile[]> {
  const res = await githubApi(
    env,
    "GET",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=250`,
  );
  const data = (await res.json()) as { files?: ComparedFile[] };

  return data.files ?? [];
}

// ---- PR Operations ----

export type PRInfo = {
  number: number;
  node_id: string;
  state: string;
  draft: boolean;
  merged: boolean;
  html_url: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export async function createPR(
  env: Env,
  title: string,
  body: string,
  head: string,
  draft = false,
): Promise<PRInfo> {
  const res = await githubApi(
    env,
    "POST",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pulls`,
    { title, body, head, base: env.GITHUB_BRANCH, draft },
  );

  return (await res.json()) as PRInfo;
}

export async function getPR(env: Env, prNumber: number): Promise<PRInfo> {
  const res = await githubApi(
    env,
    "GET",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pulls/${prNumber}`,
  );

  return (await res.json()) as PRInfo;
}

/**
 * Draft → Ready。REST 没有这个能力（POST /ready_for_review 是 404，
 * PATCH draft=false 会被静默忽略），只能走 GraphQL mutation。
 */
export async function markPRReady(env: Env, nodeId: string): Promise<void> {
  await githubGraphql(
    env,
    `mutation($id: ID!) {
      markPullRequestReadyForReview(input: { pullRequestId: $id }) {
        pullRequest { isDraft }
      }
    }`,
    { id: nodeId },
  );
}

export async function closePR(env: Env, prNumber: number): Promise<void> {
  await githubApi(
    env,
    "PATCH",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pulls/${prNumber}`,
    { state: "closed" },
  );
}
