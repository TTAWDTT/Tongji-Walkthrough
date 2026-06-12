import fs from "node:fs";
import path from "node:path";

import { markdownToHtml } from "@/lib/markdown";

export type DocNavItem = {
  type: "page";
  title: string;
  slug: string;
  href: string;
  order: number;
};

export type DocNavFolder = {
  type: "folder";
  title: string;
  slug: string;
  order: number;
  children: DocNavNode[];
};

export type DocNavNode = DocNavFolder | DocNavItem;

export type DocPageData = DocNavItem & {
  contentHtml: string;
  description?: string;
  navItems: DocNavNode[];
};

export type DocSourceItem = DocNavItem & {
  content: string;
  /** Raw frontmatter block (including `---` fences), "" when absent. */
  frontmatter: string;
  description?: string;
};

const docsDirectory = path.join(process.cwd(), "content", "docs");
const defaultOrder = 1000;

const normalizeSlug = (filePath: string) =>
  path
    .relative(docsDirectory, filePath)
    .replace(/\\/g, "/")
    .replace(/\.md$/, "");

const parseFrontmatter = (source: string) => {
  if (!source.startsWith("---")) {
    return { meta: new Map<string, string>(), body: source, raw: "" };
  }

  const end = source.indexOf("\n---", 3);

  if (end === -1) {
    return { meta: new Map<string, string>(), body: source, raw: "" };
  }

  const raw = source.slice(0, end + 4);
  const rawMeta = source.slice(3, end).trim();
  const body = source.slice(end + 4).trimStart();
  const meta = new Map<string, string>();

  rawMeta.split("\n").forEach((line) => {
    const separator = line.indexOf(":");

    if (separator === -1) return;

    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    meta.set(key, value);
  });

  return { meta, body, raw };
};

const parseOrder = (value: unknown) => {
  const order = Number(value ?? defaultOrder);

  return Number.isFinite(order) ? order : defaultOrder;
};

const getTitleFromBody = (body: string, fallback: string) => {
  const heading = body.match(/^#\s+(.+)$/m);

  return heading?.[1] ?? fallback;
};

const readDocMeta = (
  filePath: string,
): DocNavItem & { body: string; frontmatter: string; description?: string } => {
  const slug = normalizeSlug(filePath);
  const { meta, body, raw } = parseFrontmatter(
    fs.readFileSync(filePath, "utf8"),
  );
  const fallbackTitle = path.basename(slug).replace(/[-_]/g, " ");
  const title = meta.get("title") ?? getTitleFromBody(body, fallbackTitle);

  return {
    type: "page",
    title,
    slug,
    href: `/docs/${slug}`,
    order: parseOrder(meta.get("order")),
    description: meta.get("description"),
    body,
    frontmatter: raw,
  };
};

const formatSegmentTitle = (segment: string) =>
  segment
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const readFolderMeta = (
  directory: string,
  slug: string,
): Pick<DocNavFolder, "title" | "order"> => {
  const metaPath = path.join(directory, "_meta.json");
  const fallbackTitle = formatSegmentTitle(path.basename(directory));

  if (!fs.existsSync(metaPath)) {
    return {
      title: fallbackTitle,
      order: defaultOrder,
    };
  }

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      title?: unknown;
      order?: unknown;
    };

    return {
      title: typeof meta.title === "string" ? meta.title : fallbackTitle,
      order: parseOrder(meta.order),
    };
  } catch {
    return {
      title: fallbackTitle || slug,
      order: defaultOrder,
    };
  }
};

type DocRecord = DocNavItem & {
  body: string;
  frontmatter: string;
  description?: string;
};
type DocTreeRecord = DocNavFolder | DocRecord;

const sortNavNodes = <T extends { title: string; order: number }>(items: T[]) =>
  items.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

const readDocTree = (
  directory = docsDirectory,
  slugPrefix = "",
): DocTreeRecord[] => {
  if (!fs.existsSync(directory)) return [];

  const nodes = fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap<DocTreeRecord>((entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        const slug = slugPrefix ? `${slugPrefix}/${entry.name}` : entry.name;
        const children = readDocTree(entryPath, slug);
        const meta = readFolderMeta(entryPath, slug);

        return [
          {
            type: "folder",
            title: meta.title,
            slug,
            order: meta.order,
            children,
          },
        ];
      }

      if (!entry.isFile() || !entry.name.endsWith(".md")) return [];

      return [readDocMeta(entryPath)];
    });

  return sortNavNodes(nodes);
};

const flattenDocs = (nodes: DocTreeRecord[]): DocRecord[] =>
  nodes.flatMap((node) =>
    node.type === "page"
      ? [node]
      : flattenDocs(node.children as DocTreeRecord[]),
  );

const toNavTree = (nodes: DocTreeRecord[]): DocNavNode[] =>
  nodes.map((node) => {
    if (node.type === "page") {
      const { type, title, slug, href, order } = node;

      return { type, title, slug, href, order };
    }

    return {
      type: "folder",
      title: node.title,
      slug: node.slug,
      order: node.order,
      children: toNavTree(node.children as DocTreeRecord[]),
    };
  });

export const getDocNavTree = () => toNavTree(readDocTree());

export const getAllDocs = () => flattenDocs(readDocTree());

export const getAllDocSources = (): DocSourceItem[] =>
  getAllDocs().map(
    ({ type, title, slug, href, order, description, body, frontmatter }) => ({
      type,
      title,
      slug,
      href,
      order,
      description: description ?? "",
      content: body,
      frontmatter,
    }),
  );

export const getDocPaths = () =>
  getAllDocs().map((doc) => ({
    params: {
      slug: doc.slug.split("/"),
    },
  }));

export const getDocBySlug = (slug?: string | string[]): DocPageData | null => {
  const docs = getAllDocs();
  const normalizedSlug = Array.isArray(slug) ? slug.join("/") : slug;
  const doc = normalizedSlug
    ? docs.find((item) => item.slug === normalizedSlug)
    : docs[0];

  if (!doc) return null;

  return {
    title: doc.title,
    type: doc.type,
    slug: doc.slug,
    href: doc.href,
    order: doc.order,
    description: doc.description ?? "",
    contentHtml: markdownToHtml(doc.body),
    navItems: getDocNavTree(),
  };
};
