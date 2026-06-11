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

// ---- API Request / Response Types ----

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
  images?: string[] | { local_filename: string }[];
}

export interface SubmitRequest {
  profile: Profile;
  changes: Changes;
}

export interface UpdateRequest {
  prNumber: number;
  promote?: boolean;
  profile: { email: string };
  changes: Changes;
}

export interface ApiResponse {
  success: boolean;
  error?: string;
  details?: string[];
  github_response?: unknown;

  // submit / draft / update
  prNumber?: number;
  prUrl?: string;
  prType?: string;
  branch?: string;
  converted?: boolean;
  summary?: {
    modified: number;
    created: number;
    deleted: number;
    images: number;
  };

  // upload
  filename?: string;
  path?: string;
  url?: string;
  markdown?: string;
  fileSize?: number;

  // content
  sha?: string;
  content?: string;

  // history
  records?: PRMapping[];

  // cleanup
  cleaned?: { files: number; records: number };
  cutoff?: string;
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
}
