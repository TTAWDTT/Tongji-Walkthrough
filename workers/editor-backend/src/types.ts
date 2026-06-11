// ---- PR Mapping (stored in KV) ----

export interface PRMapping {
  prNumber: number;
  branchName: string;
  prType: "draft" | "ready";
  prStatus: "open" | "closed" | "merged";
  studentId: string;
  submitterName: string;
  submitterEmail: string;
  submitterQQ?: string;
  submitterGitHub?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Image Mapping (stored in KV for cleanup tracking) ----

export interface ImageRecord {
  filename: string;
  originalName: string;
  prNumber?: number;
  branchCommitted: boolean;
  fileSize: number;
  mimeType: string;
  uploaderEmail?: string;
  createdAt: string;
}

// ---- API Request Types ----

export interface Profile {
  studentId: string;
  name: string;
  email: string;
  qq?: string;
  github?: string;
}

export interface Changes {
  modified?: Record<string, string>;
  created?: Record<string, string>;
  deleted?: string[];
  images?: string[];
}

export interface SubmitRequest {
  profile: Profile;
  changes: Changes;
}

export interface UpdateRequest {
  prNumber: number;
  promote?: boolean;
  profile?: { email?: string };
  changes?: Changes;
}

export interface DiscardRequest {
  prNumber: number;
  profile?: { email?: string };
}

// ---- Environment Binding ----

export interface Env {
  EDITOR_KV: KVNamespace;
  IMAGES_BUCKET: R2Bucket;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  ALLOWED_ORIGINS: string;
  BASE_URL: string;
  /** 可选：设置后 GET /api/cleanup 需携带 Bearer token 才能手动触发 */
  ADMIN_TOKEN?: string;
}
