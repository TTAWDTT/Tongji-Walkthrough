/**
 * Pure helpers for the docs editor: tree node model, frontmatter handling
 * and change-set (diff) construction for PR submission.
 *
 * Path model:
 * - Renaming a page edits its frontmatter `title:` — the file path never
 *   changes. Renaming a folder edits its `_meta.json` title.
 * - Only dragging a node into another folder moves files; segment names of
 *   existing nodes are preserved (taken from the original slug), so a
 *   round-trip through the editor never invents new paths.
 * - New pages/folders derive their segment from the title once, at creation.
 */

export type NodeType = "folder" | "page";

export type EditNode = {
  id: string;
  type: NodeType;
  title: string;
  parentId: string | null;
  children?: EditNode[];
  content?: string;
  isDraft?: boolean;
  /** Original slug for nodes that exist in the build (e.g. "life/canteen"). */
  slug?: string;
};

export type DocSource = {
  slug: string;
  content: string;
  frontmatter: string;
};

export type FolderSource = {
  slug: string;
  title: string;
  order: number;
};

export type ChangeSet = {
  modified: Record<string, string>;
  created: Record<string, string>;
  deleted: string[];
  images: string[];
  /** Final repo path for every page node id, for committed-path tracking. */
  pathsByNodeId: Record<string, string>;
  hasChanges: boolean;
};

const DOCS_PREFIX = "content/docs";

export const slugifyTitle = (title: string): string =>
  (title || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-|-$/g, "") || "untitled";

export const lastSegment = (slug: string): string =>
  slug.split("/").pop() ?? slug;

/** Split a full doc file content into raw frontmatter block and body. */
export const splitDocSource = (
  source: string,
): { frontmatter: string; body: string } => {
  if (!source.startsWith("---")) return { frontmatter: "", body: source };
  const end = source.indexOf("\n---", 3);

  if (end === -1) return { frontmatter: "", body: source };

  return {
    frontmatter: source.slice(0, end + 4),
    body: source.slice(end + 4).replace(/^\r?\n+/, ""),
  };
};

/** Join frontmatter + body back into a committable file. */
export const joinDocSource = (frontmatter: string, body: string): string => {
  const normalizedBody = body.endsWith("\n") ? body : `${body}\n`;

  return frontmatter ? `${frontmatter}\n\n${normalizedBody}` : normalizedBody;
};

const yamlQuote = (value: string): string =>
  /[:#"'[\]{}|>&*!%@`\n]/.test(value) || /^\s|\s$/.test(value)
    ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    : value;

/** Read the `title:` value from a raw frontmatter block. */
export const getFrontmatterTitle = (frontmatter: string): string | null => {
  const match = frontmatter.match(/^title:\s*(.+)$/m);

  if (!match) return null;

  return match[1].trim().replace(/^["']|["']$/g, "") || null;
};

/** Return frontmatter with `title:` set, creating the block when absent. */
export const withFrontmatterTitle = (
  frontmatter: string,
  title: string,
): string => {
  const line = `title: ${yamlQuote(title)}`;

  if (!frontmatter) return `---\n${line}\n---`;
  if (/^title:.*$/m.test(frontmatter)) {
    return frontmatter.replace(/^title:.*$/m, line);
  }

  return frontmatter.replace(/^---\n/, `---\n${line}\n`);
};

export const folderMetaContent = (title: string, order: number): string =>
  `${JSON.stringify({ title, order }, null, 2)}\n`;

const referencedUploadedImages = (
  imageNames: string[],
  contents: Record<string, string>,
): string[] => {
  const source = Object.values(contents).join("\n");

  return [...new Set(imageNames)].filter((name) => source.includes(name));
};

const docPath = (dirPrefix: string, fileSegment: string): string =>
  dirPrefix
    ? `${DOCS_PREFIX}/${dirPrefix}/${fileSegment}.md`
    : `${DOCS_PREFIX}/${fileSegment}.md`;

const metaPath = (dirPath: string): string =>
  `${DOCS_PREFIX}/${dirPath}/_meta.json`;

export function buildChanges(args: {
  tree: EditNode[];
  docs: DocSource[];
  folders: FolderSource[];
  /** Current body per page node id. */
  contents: Record<string, string>;
  /** Current raw frontmatter per page node id. */
  frontmatters: Record<string, string>;
  /** Baseline body per page node id (build output or refreshed main). */
  initialContents: Record<string, string>;
  /** Baseline frontmatter per page node id. */
  initialFrontmatters: Record<string, string>;
  /** Paths previously committed to the PR branch, per node id. */
  committedPaths: Record<string, string>;
  uploadedImages: string[];
}): ChangeSet {
  const {
    tree,
    docs,
    folders,
    contents,
    frontmatters,
    initialContents,
    initialFrontmatters,
    committedPaths,
    uploadedImages,
  } = args;

  const modified: Record<string, string> = {};
  const created: Record<string, string> = {};
  const deleted = new Set<string>();
  const pathsByNodeId: Record<string, string> = {};
  const usedPaths = new Set<string>();
  const foldersBySlug = new Map(folders.map((f) => [f.slug, f]));

  const claimPath = (wanted: string): string => {
    if (!usedPaths.has(wanted)) {
      usedPaths.add(wanted);

      return wanted;
    }
    const base = wanted.replace(/\.md$/, "");
    let i = 2;

    while (usedPaths.has(`${base}-${i}.md`)) i += 1;
    const result = `${base}-${i}.md`;

    usedPaths.add(result);

    return result;
  };

  // Reserve original paths of unmoved pages first so collision suffixes only
  // ever apply to moved/new pages.
  const walkReserve = (nodes: EditNode[], dirPrefix: string) => {
    for (const node of nodes) {
      if (node.type === "page" && node.slug) {
        const fileSegment = lastSegment(node.slug);
        const currentPath = docPath(dirPrefix, fileSegment);
        const originalPath = docPath(
          node.slug.split("/").slice(0, -1).join("/"),
          fileSegment,
        );

        if (currentPath === originalPath) usedPaths.add(originalPath);
      } else if (node.type === "folder") {
        const segment = node.slug
          ? lastSegment(node.slug)
          : slugifyTitle(node.title);

        walkReserve(
          node.children ?? [],
          dirPrefix ? `${dirPrefix}/${segment}` : segment,
        );
      }
    }
  };

  walkReserve(tree, "");

  const walk = (nodes: EditNode[], dirPrefix: string) => {
    for (const node of nodes) {
      if (node.type === "folder") {
        const segment = node.slug
          ? lastSegment(node.slug)
          : slugifyTitle(node.title);
        const dirPath = dirPrefix ? `${dirPrefix}/${segment}` : segment;

        if (node.slug) {
          const original = foldersBySlug.get(node.slug);
          const movedDir = dirPath !== node.slug;
          const titleChanged = original ? node.title !== original.title : true;
          const order = original?.order ?? 1000;

          if (movedDir) {
            // Directory moved: its _meta.json travels with it.
            deleted.add(metaPath(node.slug));
            created[metaPath(dirPath)] = folderMetaContent(node.title, order);
          } else if (titleChanged) {
            modified[metaPath(dirPath)] = folderMetaContent(node.title, order);
          }
        } else {
          created[metaPath(dirPath)] = folderMetaContent(node.title, 1000);
        }

        pathsByNodeId[node.id] = metaPath(dirPath);
        const committedMeta = committedPaths[node.id];

        if (committedMeta && committedMeta !== metaPath(dirPath)) {
          deleted.add(committedMeta);
        }

        walk(node.children ?? [], dirPath);
        continue;
      }

      const body = contents[node.id] ?? node.content ?? "";
      const frontmatter = frontmatters[node.id] ?? "";
      const fileContent = joinDocSource(frontmatter, body);

      if (node.slug) {
        const fileSegment = lastSegment(node.slug);
        const originalDir = node.slug.split("/").slice(0, -1).join("/");
        const originalPath = docPath(originalDir, fileSegment);
        const wantedPath = docPath(dirPrefix, fileSegment);
        const movedDir = wantedPath !== originalPath;
        const currentPath = movedDir ? claimPath(wantedPath) : originalPath;

        pathsByNodeId[node.id] = currentPath;

        const initialBody = initialContents[node.id];
        const initialFm = initialFrontmatters[node.id] ?? "";
        const isKnownDoc = initialBody !== undefined;
        const changed =
          !isKnownDoc || initialBody !== body || initialFm !== frontmatter;

        if (movedDir) {
          deleted.add(originalPath);
          created[currentPath] = fileContent;
        } else if (!isKnownDoc) {
          // Restored from the PR branch (file not in the build): keep it in
          // the change set so updates are idempotent; the backend skips
          // writes whose content is already on the branch.
          created[currentPath] = fileContent;
        } else if (changed) {
          modified[currentPath] = fileContent;
        }
      } else {
        const wantedPath = docPath(dirPrefix, slugifyTitle(node.title));
        const currentPath = claimPath(wantedPath);

        pathsByNodeId[node.id] = currentPath;
        created[currentPath] = fileContent;
      }

      const committed = committedPaths[node.id];

      if (committed && committed !== pathsByNodeId[node.id]) {
        deleted.add(committed);
      }
    }
  };

  walk(tree, "");

  // Pages removed from the tree.
  const presentIds = new Set<string>();
  const collect = (nodes: EditNode[]) => {
    for (const node of nodes) {
      presentIds.add(node.id);
      if (node.children) collect(node.children);
    }
  };

  collect(tree);

  for (const doc of docs) {
    if (!presentIds.has(`page:${doc.slug}`)) {
      const dir = doc.slug.split("/").slice(0, -1).join("/");

      deleted.add(docPath(dir, lastSegment(doc.slug)));
    }
  }

  // Folders removed from the tree: clean up their _meta.json.
  for (const folder of folders) {
    if (!presentIds.has(`folder:${folder.slug}`)) {
      deleted.add(metaPath(folder.slug));
    }
  }

  // Previously committed draft pages whose nodes were removed.
  for (const [nodeId, committedPath] of Object.entries(committedPaths)) {
    if (!presentIds.has(nodeId)) deleted.add(committedPath);
  }

  // Never delete a path we are also writing.
  for (const p of [...Object.keys(modified), ...Object.keys(created)]) {
    deleted.delete(p);
  }

  const images = referencedUploadedImages(uploadedImages, contents);
  const deletedList = [...deleted];
  const hasChanges =
    Object.keys(modified).length > 0 ||
    Object.keys(created).length > 0 ||
    deletedList.length > 0 ||
    images.length > 0;

  return {
    modified,
    created,
    deleted: deletedList,
    images,
    pathsByNodeId,
    hasChanges,
  };
}

/** Parse a repo doc path into folder slug chain + file segment. */
export const parseDocPath = (
  path: string,
): { dirSlug: string; fileSegment: string; slug: string } | null => {
  if (!path.startsWith(`${DOCS_PREFIX}/`) || !path.endsWith(".md")) {
    return null;
  }
  const slug = path.slice(DOCS_PREFIX.length + 1, -".md".length);
  const parts = slug.split("/");

  return {
    dirSlug: parts.slice(0, -1).join("/"),
    fileSegment: parts[parts.length - 1],
    slug,
  };
};

export const parseMetaPath = (path: string): { dirSlug: string } | null => {
  if (!path.startsWith(`${DOCS_PREFIX}/`) || !path.endsWith("/_meta.json")) {
    return null;
  }

  return { dirSlug: path.slice(DOCS_PREFIX.length + 1, -"/_meta.json".length) };
};
