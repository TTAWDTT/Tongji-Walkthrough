/**
 * GitHub API 封装
 */
import type { Env } from "./types";

const GITHUB_API = "https://api.github.com";

// UTF-8 safe base64 helpers (for Chinese/non-Latin-1 content)
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function base64ToUtf8(encoded: string): string {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function githubApi(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = `${GITHUB_API}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "Tongji-Walkthrough-Editor/1.0",
  };

  const res = await fetch(url, {
    method,
    headers,
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

// ---- Repo Operations ----

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
    {
      ref: `refs/heads/${branchName}`,
      sha: main.object.sha,
    },
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

async function getFileFromBranch(
  env: Env,
  path: string,
  branch: string,
): Promise<{ content: string; sha: string } | null> {
  try {
    const res = await githubApi(
      env,
      "GET",
      `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${branch}`,
    );
    const data = (await res.json()) as { content: string; sha: string };
    return {
      content: base64ToUtf8(data.content),
      sha: data.sha,
    };
  } catch {
    return null;
  }
}

async function commitFileOnBranch(
  env: Env,
  branch: string,
  path: string,
  content: string,
  sha: string | undefined,
  message: string,
): Promise<void> {
  const body: Record<string, string> = {
    branch,
    message,
    content: utf8ToBase64(content),
  };
  if (sha) body.sha = sha;

  await githubApi(
    env,
    "PUT",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,
    body,
  );
}

export async function writeFilesToBranch(
  env: Env,
  branch: string,
  modified: Record<string, string>,
  created: Record<string, string>,
  deleted: string[],
  checkCreatedOnBranch = false,
): Promise<void> {
  // Modified files: get sha from current branch, fallback to main, then overwrite
  for (const [filePath, content] of Object.entries(modified)) {
    const existing =
      (await getFileFromBranch(env, filePath, branch)) ??
      (await getFileFromBranch(env, filePath, env.GITHUB_BRANCH));
    const sha = existing?.sha;
    await commitFileOnBranch(
      env,
      branch,
      filePath,
      content,
      sha,
      `[编辑更新] Update ${filePath.split("/").pop()}`,
    );
    await sleep(200);
  }

  // Created files: check if it already exists on branch (from prior draft)
  for (const [filePath, content] of Object.entries(created)) {
    let sha: string | undefined;
    if (checkCreatedOnBranch) {
      const branchFile = await getFileFromBranch(env, filePath, branch);
      sha = branchFile?.sha;
    }
    await commitFileOnBranch(
      env,
      branch,
      filePath,
      content,
      sha,
      `[编辑更新] Create ${filePath.split("/").pop()}`,
    );
    await sleep(200);
  }

  // Deleted files
  for (const filePath of deleted) {
    const existing = await getFileFromBranch(env, filePath, branch);
    if (existing) {
      await githubApi(
        env,
        "DELETE",
        `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${filePath}`,
        {
          branch,
          message: `[编辑更新] Delete ${filePath.split("/").pop()}`,
          sha: existing.sha,
        },
      );
      await sleep(200);
    }
  }
}

export async function getFileContent(
  env: Env,
  path: string,
  ref = "main",
): Promise<{ content: string; sha: string } | null> {
  return getFileFromBranch(env, path, ref);
}

export async function uploadImageToBranch(
  env: Env,
  branch: string,
  repoPath: string,
  imageData: ArrayBuffer,
): Promise<void> {
  // Convert ArrayBuffer to base64
  const uint8 = new Uint8Array(imageData);
  const binary = uint8.reduce(
    (acc, byte) => acc + String.fromCharCode(byte),
    "",
  );
  const base64 = btoa(binary);

  await githubApi(
    env,
    "PUT",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${repoPath}`,
    {
      branch,
      message: `Upload image: ${repoPath.split("/").pop()}`,
      content: base64,
    },
  );
}

// ---- PR Operations ----

export async function createPR(
  env: Env,
  title: string,
  body: string,
  head: string,
  draft = false,
): Promise<{ number: number; html_url: string }> {
  const res = await githubApi(
    env,
    "POST",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pulls`,
    {
      title,
      body,
      head,
      base: env.GITHUB_BRANCH,
      draft,
    },
  );
  return (await res.json()) as { number: number; html_url: string };
}

export async function markPRReady(env: Env, prNumber: number): Promise<void> {
  await githubApi(
    env,
    "POST",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pulls/${prNumber}/ready_for_review`,
  );
}

export async function getPR(
  env: Env,
  prNumber: number,
): Promise<{
  state: string;
  draft: boolean;
  html_url: string;
  merged: boolean;
  title: string;
  created_at: string;
  updated_at: string;
}> {
  const res = await githubApi(
    env,
    "GET",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pulls/${prNumber}`,
  );
  return (await res.json()) as {
    state: string;
    draft: boolean;
    html_url: string;
    merged: boolean;
    title: string;
    created_at: string;
    updated_at: string;
  };
}

// ---- Utility ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
