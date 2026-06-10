import fs from "node:fs";
import path from "node:path";

import { markdownToHtml } from "@/lib/markdown";

export type DocNavItem = {
  title: string;
  slug: string;
  href: string;
  order: number;
};

export type DocPageData = DocNavItem & {
  contentHtml: string;
  description?: string;
  navItems: DocNavItem[];
};

const docsDirectory = path.join(process.cwd(), "content", "docs");

const getMarkdownFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return getMarkdownFiles(entryPath);
    }

    return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
  });
};

const normalizeSlug = (filePath: string) =>
  path
    .relative(docsDirectory, filePath)
    .replace(/\\/g, "/")
    .replace(/\.md$/, "");

const parseFrontmatter = (source: string) => {
  if (!source.startsWith("---")) {
    return { meta: new Map<string, string>(), body: source };
  }

  const end = source.indexOf("\n---", 3);

  if (end === -1) {
    return { meta: new Map<string, string>(), body: source };
  }

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

  return { meta, body };
};

const getTitleFromBody = (body: string, fallback: string) => {
  const heading = body.match(/^#\s+(.+)$/m);

  return heading?.[1] ?? fallback;
};

const readDocMeta = (
  filePath: string,
): DocNavItem & { body: string; description?: string } => {
  const slug = normalizeSlug(filePath);
  const { meta, body } = parseFrontmatter(fs.readFileSync(filePath, "utf8"));
  const fallbackTitle = path.basename(slug).replace(/[-_]/g, " ");
  const title = meta.get("title") ?? getTitleFromBody(body, fallbackTitle);
  const order = Number(meta.get("order") ?? 1000);

  return {
    title,
    slug,
    href: `/docs/${slug}`,
    order: Number.isFinite(order) ? order : 1000,
    description: meta.get("description"),
    body,
  };
};

export const getAllDocs = () =>
  getMarkdownFiles(docsDirectory)
    .map(readDocMeta)
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

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
    slug: doc.slug,
    href: doc.href,
    order: doc.order,
    description: doc.description,
    contentHtml: markdownToHtml(doc.body),
    navItems: docs.map(({ title, slug, href, order }) => ({
      title,
      slug,
      href,
      order,
    })),
  };
};
