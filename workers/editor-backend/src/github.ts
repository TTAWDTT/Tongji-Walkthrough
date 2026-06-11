/**
 * GitHub API 封装
 */
import type { Env } from "./types";

const GITHUB_API = "https://api.github.com";

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

export async function getRef(env: Env, ref: string): Promise<{ sha: string }> {
  const res = await githubApi(
    env,
    "GET",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/ref/heads/${ref}`,
  );
  return (await res.json()) as { object: { sha: string } } as unknown as {
    sha: string;
  };
}

export async function createBranch(
  env: Env,
  branchName: string,
): Promise<void> {
  const main = await getRef(env, env.GITHUB_BRANCH);
  const mainData = main as unknown as { object: { sha: string } };
  await githubApi(
    env,
    "POST",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/refs`,
    {
      ref: `refs/heads/${branchName}`,
      sha: mainData.object.sha,
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
      content: atob(data.content),
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
    content: btoa(content),
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
): Promise<void> {
  // Modified files: get sha from current branch or main, then overwrite
  for (const [filePath, content] of Object.entries(modified)) {
    const existing = await getFileFromBranch(env, filePath, branch);
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

  // Created files: no sha needed
  for (const [filePath, content] of Object.entries(created)) {
    await commitFileOnBranch(
      env,
      branch,
      filePath,
      content,
      undefined,
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
    "PATCH",
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pulls/${prNumber}`,
    { draft: false },
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
