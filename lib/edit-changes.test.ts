import { describe, expect, it } from "bun:test";

import {
  buildChanges,
  getFrontmatterTitle,
  joinDocSource,
  parseDocPath,
  parseMetaPath,
  slugifyTitle,
  splitDocSource,
  withFrontmatterTitle,
  type DocSource,
  type EditNode,
  type FolderSource,
} from "./edit-changes";

// ---- fixtures：模拟 main 上的两个文档 + 一个文件夹 ----

const introFm = `---\ntitle: Introduction\ndescription: Start here.\norder: 1\n---`;
const introBody = "## How this works\n\nIntro content\n";
const canteenFm = `---\ntitle: 食堂攻略\norder: 2\n---`;
const canteenBody = "## 食堂\n\n好吃\n";

const docs: DocSource[] = [
  { slug: "introduction", content: introBody, frontmatter: introFm },
  { slug: "life/canteen", content: canteenBody, frontmatter: canteenFm },
];

const folders: FolderSource[] = [{ slug: "life", title: "生活", order: 10 }];

const baseTree = (): EditNode[] => [
  {
    id: "page:introduction",
    type: "page",
    title: "Introduction",
    parentId: null,
    slug: "introduction",
  },
  {
    id: "folder:life",
    type: "folder",
    title: "生活",
    parentId: null,
    slug: "life",
    children: [
      {
        id: "page:life/canteen",
        type: "page",
        title: "食堂攻略",
        parentId: "folder:life",
        slug: "life/canteen",
      },
    ],
  },
];

const baseArgs = () => ({
  tree: baseTree(),
  docs,
  folders,
  contents: {
    "page:introduction": introBody,
    "page:life/canteen": canteenBody,
  },
  frontmatters: {
    "page:introduction": introFm,
    "page:life/canteen": canteenFm,
  },
  initialContents: {
    "page:introduction": introBody,
    "page:life/canteen": canteenBody,
  },
  initialFrontmatters: {
    "page:introduction": introFm,
    "page:life/canteen": canteenFm,
  },
  committedPaths: {},
  uploadedImages: [] as string[],
});

describe("frontmatter helpers", () => {
  it("splits and rejoins a doc losslessly", () => {
    const source = `${introFm}\n\n${introBody}`;
    const { frontmatter, body } = splitDocSource(source);

    expect(frontmatter).toBe(introFm);
    expect(body).toBe(introBody);
    expect(joinDocSource(frontmatter, body)).toBe(source);
  });

  it("handles documents without frontmatter", () => {
    const { frontmatter, body } = splitDocSource("# Title\n\ntext\n");

    expect(frontmatter).toBe("");
    expect(body).toBe("# Title\n\ntext\n");
  });

  it("reads and writes the title field", () => {
    expect(getFrontmatterTitle(introFm)).toBe("Introduction");
    const renamed = withFrontmatterTitle(introFm, "新标题");

    expect(getFrontmatterTitle(renamed)).toBe("新标题");
    // 其余字段保持不变
    expect(renamed).toContain("description: Start here.");
  });

  it("creates a frontmatter block when absent", () => {
    const fm = withFrontmatterTitle("", "Hello: World");

    expect(getFrontmatterTitle(fm)).toBe("Hello: World");
  });
});

describe("path helpers", () => {
  it("slugifies titles", () => {
    expect(slugifyTitle("Campus Notes")).toBe("campus-notes");
    expect(slugifyTitle("新生指南")).toBe("新生指南");
    expect(slugifyTitle("  ")).toBe("untitled");
  });

  it("parses doc and meta paths", () => {
    expect(parseDocPath("content/docs/life/canteen.md")).toEqual({
      dirSlug: "life",
      fileSegment: "canteen",
      slug: "life/canteen",
    });
    expect(parseDocPath("public/images/x.png")).toBeNull();
    expect(parseMetaPath("content/docs/life/_meta.json")).toEqual({
      dirSlug: "life",
    });
  });
});

describe("buildChanges", () => {
  it("reports no changes for a pristine tree", () => {
    const result = buildChanges(baseArgs());

    expect(result.hasChanges).toBe(false);
    expect(result.modified).toEqual({});
    expect(result.created).toEqual({});
    expect(result.deleted).toEqual([]);
  });

  it("keeps the original path when only content changes", () => {
    const args = baseArgs();

    args.contents["page:life/canteen"] = "## 食堂\n\n更好吃\n";
    const result = buildChanges(args);

    expect(Object.keys(result.modified)).toEqual([
      "content/docs/life/canteen.md",
    ]);
    expect(result.deleted).toEqual([]);
    // frontmatter 原样保留
    expect(result.modified["content/docs/life/canteen.md"]).toContain(
      "title: 食堂攻略",
    );
  });

  it("treats a page rename as a frontmatter edit, not a file move", () => {
    const args = baseArgs();

    args.frontmatters["page:life/canteen"] = withFrontmatterTitle(
      canteenFm,
      "食堂指北",
    );
    const result = buildChanges(args);

    expect(Object.keys(result.modified)).toEqual([
      "content/docs/life/canteen.md",
    ]);
    expect(result.created).toEqual({});
    expect(result.deleted).toEqual([]);
  });

  it("moves a page when its tree position changes", () => {
    const args = baseArgs();
    const tree = args.tree;
    const life = tree[1];
    const canteen = life.children![0];

    life.children = [];
    tree.push({ ...canteen, parentId: null });
    const result = buildChanges(args);

    expect(result.deleted).toContain("content/docs/life/canteen.md");
    expect(Object.keys(result.created)).toEqual(["content/docs/canteen.md"]);
    // 移动保留原文件名与 frontmatter
    expect(result.created["content/docs/canteen.md"]).toContain(
      "title: 食堂攻略",
    );
  });

  it("renames a folder via _meta.json without touching child paths", () => {
    const args = baseArgs();

    args.tree[1].title = "校园生活";
    const result = buildChanges(args);

    expect(result.modified["content/docs/life/_meta.json"]).toContain(
      "校园生活",
    );
    // order 保留
    expect(result.modified["content/docs/life/_meta.json"]).toContain("10");
    expect(result.deleted).toEqual([]);
    expect(result.created).toEqual({});
  });

  it("creates new pages and folders with slugified segments", () => {
    const args = baseArgs();

    args.tree.push({
      id: "draft-folder-1",
      type: "folder",
      title: "Study Tips",
      parentId: null,
      children: [
        {
          id: "draft-page-1",
          type: "page",
          title: "选课指南",
          parentId: "draft-folder-1",
        },
      ],
    });
    args.contents["draft-page-1"] = "# 选课\n";
    args.frontmatters["draft-page-1"] = withFrontmatterTitle("", "选课指南");
    const result = buildChanges(args);

    expect(result.created["content/docs/study-tips/_meta.json"]).toContain(
      "Study Tips",
    );
    expect(result.created["content/docs/study-tips/选课指南.md"]).toContain(
      "title: 选课指南",
    );
  });

  it("deletes removed pages and orphaned folder meta", () => {
    const args = baseArgs();

    args.tree = [args.tree[0]]; // 移除 life 文件夹及其子页面
    const result = buildChanges(args);

    expect(result.deleted).toContain("content/docs/life/canteen.md");
    expect(result.deleted).toContain("content/docs/life/_meta.json");
  });

  it("cleans up stale committed paths after a draft page rename", () => {
    const args = baseArgs();

    args.tree.push({
      id: "draft-page-1",
      type: "page",
      title: "新名字",
      parentId: null,
    });
    args.contents["draft-page-1"] = "# 内容\n";
    // 上次提交时该草稿页叫别的名字
    args.committedPaths = { "draft-page-1": "content/docs/旧名字.md" };
    const result = buildChanges(args);

    expect(Object.keys(result.created)).toContain("content/docs/新名字.md");
    expect(result.deleted).toContain("content/docs/旧名字.md");
  });

  it("deletes committed paths of nodes removed from the tree", () => {
    const args = baseArgs();

    args.committedPaths = { "draft-page-gone": "content/docs/draft-gone.md" };
    const result = buildChanges(args);

    expect(result.deleted).toContain("content/docs/draft-gone.md");
  });

  it("keeps restored branch-only pages in the change set (idempotent)", () => {
    const args = baseArgs();

    // 从分支恢复的页面：不在 build docs 里，但有 slug + committedPath
    args.tree.push({
      id: "page:restored",
      type: "page",
      title: "Restored",
      parentId: null,
      slug: "restored",
    });
    args.contents["page:restored"] = "# Restored\n";
    args.committedPaths = { "page:restored": "content/docs/restored.md" };
    const result = buildChanges(args);

    expect(Object.keys(result.created)).toContain("content/docs/restored.md");
    expect(result.deleted).toEqual([]);
  });

  it("suffixes colliding paths instead of overwriting", () => {
    const args = baseArgs();

    args.tree.push(
      {
        id: "draft-page-1",
        type: "page",
        title: "Introduction",
        parentId: null,
      },
      {
        id: "draft-page-2",
        type: "page",
        title: "Introduction",
        parentId: null,
      },
    );
    args.contents["draft-page-1"] = "# A\n";
    args.contents["draft-page-2"] = "# B\n";
    const result = buildChanges(args);
    const created = Object.keys(result.created).sort();

    // 与现有 introduction.md 以及彼此都不冲突
    expect(created).toEqual([
      "content/docs/introduction-2.md",
      "content/docs/introduction-3.md",
    ]);
  });

  it("dedupes uploaded images", () => {
    const args = baseArgs();

    args.uploadedImages = ["a.png", "a.png", "b.png"];
    const result = buildChanges(args);

    expect(result.images).toEqual(["a.png", "b.png"]);
    expect(result.hasChanges).toBe(true);
  });
});
