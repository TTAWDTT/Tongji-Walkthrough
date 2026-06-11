/**
 * Client for the editor backend (Cloudflare Worker) plus the localStorage
 * draft-PR cache shared between the editor layout and the markdown editor.
 */

export const PR_CACHE_KEY = "edit_pr_info";

export type CachedPR = {
  prNumber: number;
  type: string;
  email: string;
  profile?: CachedProfile;
};

export type CachedProfile = {
  studentId: string;
  name: string;
  email: string;
  qq: string;
  github: string;
};

export const normalizeEmail = (email: string): string => email.trim();

export const normalizeCachedProfile = (
  profile: Partial<CachedProfile> | undefined,
): CachedProfile | undefined => {
  if (!profile) return undefined;

  return {
    studentId: profile.studentId?.trim() ?? "",
    name: profile.name?.trim() ?? "",
    email: normalizeEmail(profile.email ?? ""),
    qq: profile.qq?.trim() ?? "",
    github: profile.github?.trim() ?? "",
  };
};

export type PRFileChange = {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  previousPath?: string;
  content?: string;
};

export type PRChanges = {
  prNumber: number;
  prType: string;
  branch: string;
  files: PRFileChange[];
  images: string[];
};

export type SubmitResult = {
  prNumber: number;
  prUrl: string;
  prType: string;
  converted?: boolean;
  promoteFailed?: boolean;
};

export type DocsListing = {
  branch: string;
  rawBase: string;
  files: { path: string; sha: string }[];
};

export const getApiBaseUrl = (): string =>
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export const readCachedPR = (): CachedPR | null => {
  try {
    const raw = localStorage.getItem(PR_CACHE_KEY);

    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPR;

    if (typeof parsed?.prNumber !== "number") return null;

    return {
      ...parsed,
      email: normalizeEmail(parsed.email ?? ""),
      profile: normalizeCachedProfile(parsed.profile),
    };
  } catch {
    return null;
  }
};

export const writeCachedPR = (value: CachedPR): void => {
  try {
    localStorage.setItem(
      PR_CACHE_KEY,
      JSON.stringify({
        ...value,
        email: normalizeEmail(value.email),
        profile: normalizeCachedProfile(value.profile),
      }),
    );
  } catch {
    /* storage unavailable */
  }
};

export const clearCachedPR = (): void => {
  try {
    localStorage.removeItem(PR_CACHE_KEY);
  } catch {
    /* storage unavailable */
  }
};

/** HTTP error from the backend, carrying the response status. */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const parseError = async (res: Response): Promise<string> => {
  const fallback = `请求失败 (HTTP ${res.status})`;

  try {
    const data = (await res.json()) as { error?: string };

    return data.error ?? fallback;
  } catch {
    return fallback;
  }
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBaseUrl();

  if (!base) throw new Error("后端服务未配置 (NEXT_PUBLIC_API_BASE_URL 为空)");
  const res = await fetch(`${base}${path}`, init);

  if (!res.ok) throw new ApiError(await parseError(res), res.status);

  return (await res.json()) as T;
}

const postJson = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export type ChangesPayload = {
  modified: Record<string, string>;
  created: Record<string, string>;
  deleted: string[];
  images: string[];
};

export type ProfilePayload = {
  studentId: string;
  name: string;
  email: string;
  qq?: string;
  github?: string;
};

export const createDraftPR = (
  profile: ProfilePayload,
  changes: ChangesPayload,
): Promise<SubmitResult> => postJson("/api/draft", { profile, changes });

export const createReadyPR = (
  profile: ProfilePayload,
  changes: ChangesPayload,
): Promise<SubmitResult> => postJson("/api/submit", { profile, changes });

export const updatePR = (
  prNumber: number,
  email: string,
  changes: ChangesPayload,
  promote: boolean,
): Promise<SubmitResult> =>
  postJson("/api/update", {
    prNumber,
    promote,
    profile: { email },
    changes,
  });

export const discardPR = (
  prNumber: number,
  email: string,
): Promise<{ success: boolean }> =>
  postJson("/api/discard", { prNumber, profile: { email } });

export const fetchPRChanges = (
  prNumber: number,
  email: string,
): Promise<PRChanges> =>
  request(
    `/api/pr-changes?pr_number=${prNumber}&email=${encodeURIComponent(email)}`,
  );

export const fetchDocsListing = (): Promise<DocsListing> =>
  request("/api/docs");

export type UploadResult = {
  filename: string;
  url: string;
  markdown: string;
};

/**
 * Upload an image to the backend; falls back to an inline base64 data URL
 * when no backend is configured.
 */
export const uploadEditorImage = async (image: File): Promise<UploadResult> => {
  if (!image.type.startsWith("image/")) {
    throw new Error("Only image files can be uploaded.");
  }

  if (!getApiBaseUrl()) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.addEventListener("load", () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("Failed to read image."));
      });
      reader.addEventListener("error", () => {
        reject(reader.error ?? new Error("Failed to read image."));
      });
      reader.readAsDataURL(image);
    });

    return { filename: "", url: dataUrl, markdown: "" };
  }

  const formData = new FormData();

  formData.append("image", image);

  const cached = readCachedPR();

  if (cached) {
    formData.append("pr_number", String(cached.prNumber));
    formData.append("email", cached.email);
  }

  return request<UploadResult>("/api/upload", {
    method: "POST",
    body: formData,
  });
};
