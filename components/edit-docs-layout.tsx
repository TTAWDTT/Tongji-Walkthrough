import type { DragEvent } from "react";
import type { DocNavNode, DocSourceItem } from "@/lib/docs";
import type { EditNode } from "@/lib/edit-changes";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Form, InputGroup, Modal, TextField } from "@heroui/react";
import clsx from "clsx";

import { Head } from "@/layouts/head";
import { NavbarActions, NavbarBrand } from "@/components/navbar";
import {
  buildChanges,
  getFrontmatterTitle,
  parseDocPath,
  parseMetaPath,
  splitDocSource,
  withFrontmatterTitle,
  type ChangeSet,
  type FolderSource,
} from "@/lib/edit-changes";
import {
  ApiError,
  clearCachedPR,
  createDraftPR,
  createReadyPR,
  discardPR,
  fetchDocsListing,
  fetchPRChanges,
  getApiBaseUrl,
  normalizeEmail,
  normalizeCachedProfile,
  readCachedPR,
  updatePR,
  writeCachedPR,
  type CachedPR,
  type ChangesPayload,
  type PRChanges,
  type SubmitResult,
} from "@/lib/editor-api";

type Profile = {
  studentId: string;
  name: string;
  email: string;
  qq: string;
  github: string;
};

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onImageUploaded?: (filename: string) => void;
};

type InsertPosition = "before" | "after";

type InsertTarget = {
  id: string;
  position: InsertPosition;
};

const FOLDER_INSERT_EDGE_RATIO = 0.2;

const MarkdownEditor = dynamic<MarkdownEditorProps>(
  () => import("@/components/markdown-editor-client"),
  {
    loading: () => (
      <div className="markdown-editor-loading">Loading editor...</div>
    ),
    ssr: false,
  },
);

const defaultProfile: Profile = {
  studentId: "",
  name: "",
  email: "",
  qq: "",
  github: "",
};

const getMarkdownTitle = (content?: string) => {
  const title = content?.match(/^#\s+(.+)$/m)?.[1]?.trim();

  return title || null;
};

const cloneNodes = (nodes: EditNode[]): EditNode[] =>
  nodes.map((node) => ({
    ...node,
    children: node.children ? cloneNodes(node.children) : undefined,
  }));

const findNode = (nodes: EditNode[], id: string): EditNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node;

    const child = node.children ? findNode(node.children, id) : null;

    if (child) return child;
  }

  return null;
};

const isDescendant = (
  nodes: EditNode[],
  parentId: string,
  possibleChildId: string,
) => {
  const parent = findNode(nodes, parentId);

  if (!parent?.children) return false;

  return Boolean(findNode(parent.children, possibleChildId));
};

const removeNode = (
  nodes: EditNode[],
  id: string,
): [EditNode[], EditNode | null] => {
  let removed: EditNode | null = null;
  const nextNodes: EditNode[] = [];

  for (const node of nodes) {
    if (node.id === id) {
      removed = node;

      continue;
    }

    if (node.children) {
      const [children, childRemoved] = removeNode(node.children, id);

      if (childRemoved) removed = childRemoved;

      nextNodes.push({ ...node, children });

      continue;
    }

    nextNodes.push(node);
  }

  return [nextNodes, removed];
};

const appendNode = (
  nodes: EditNode[],
  parentId: string | null,
  nodeToAppend: EditNode,
): EditNode[] => {
  const nextNode = { ...nodeToAppend, parentId };

  if (!parentId) return [...nodes, nextNode];

  return nodes.map((node) => {
    if (node.id === parentId && node.type === "folder") {
      return {
        ...node,
        children: [...(node.children ?? []), nextNode],
      };
    }

    if (node.children) {
      return {
        ...node,
        children: appendNode(node.children, parentId, nodeToAppend),
      };
    }

    return node;
  });
};

const insertNodeNear = (
  nodes: EditNode[],
  targetId: string,
  position: InsertPosition,
  nodeToInsert: EditNode,
): EditNode[] => {
  const targetIndex = nodes.findIndex((node) => node.id === targetId);

  if (targetIndex >= 0) {
    const target = nodes[targetIndex];
    const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
    const nextNode = { ...nodeToInsert, parentId: target.parentId };

    return [
      ...nodes.slice(0, insertIndex),
      nextNode,
      ...nodes.slice(insertIndex),
    ];
  }

  return nodes.map((node) =>
    node.children
      ? {
          ...node,
          children: insertNodeNear(
            node.children,
            targetId,
            position,
            nodeToInsert,
          ),
        }
      : node,
  );
};

const getListGapInsertTarget = (
  listElement: HTMLUListElement,
  clientY: number,
  nodes: EditNode[],
  parentFolderId: string | null,
): InsertTarget | null => {
  const rows = Array.from(listElement.children).flatMap((child, index) => {
    if (!(child instanceof HTMLElement)) return [];
    const shell = child.querySelector<HTMLElement>(
      ":scope > .edit-tree-drag-shell",
    );

    if (!shell || !nodes[index]) return [];

    return [{ node: nodes[index], rect: shell.getBoundingClientRect() }];
  });

  if (!rows.length) return null;

  const first = rows[0];
  const last = rows[rows.length - 1];

  if (clientY < first.rect.top) {
    return { id: first.node.id, position: "before" };
  }

  for (let index = 0; index < rows.length; index += 1) {
    const current = rows[index];
    const next = rows[index + 1];

    if (clientY >= current.rect.top && clientY <= current.rect.bottom) {
      return null;
    }

    if (next && clientY > current.rect.bottom && clientY < next.rect.top) {
      return { id: current.node.id, position: "after" };
    }
  }

  if (clientY > last.rect.bottom) {
    return {
      id: parentFolderId ?? last.node.id,
      position: "after",
    };
  }

  return null;
};

const updateNodeTitle = (
  nodes: EditNode[],
  id: string,
  title: string,
): EditNode[] =>
  nodes.map((node) => {
    if (node.id === id) return { ...node, title };

    if (node.children) {
      return { ...node, children: updateNodeTitle(node.children, id, title) };
    }

    return node;
  });

const getFolderIds = (nodes: EditNode[]) => {
  const ids = new Set<string>();

  const walk = (items: EditNode[]) => {
    items.forEach((item) => {
      if (item.type === "folder") {
        ids.add(item.id);
        walk(item.children ?? []);
      }
    });
  };

  walk(nodes);

  return ids;
};

const buildTreeFromNav = (
  items: DocNavNode[],
  docsBySlug: Map<string, DocSourceItem>,
  parentId: string | null = null,
): EditNode[] =>
  items.map((item) => {
    if (item.type === "folder") {
      const id = `folder:${item.slug}`;

      return {
        id,
        type: "folder",
        title: item.title,
        parentId,
        slug: item.slug,
        children: buildTreeFromNav(item.children, docsBySlug, id),
      };
    }

    const doc = docsBySlug.get(item.slug);

    return {
      id: `page:${item.slug}`,
      type: "page",
      title: item.title,
      parentId,
      slug: item.slug,
      content: doc?.content ?? "",
    };
  });

const collectFolderSources = (items: DocNavNode[]): FolderSource[] =>
  items.flatMap((item) =>
    item.type === "folder"
      ? [
          { slug: item.slug, title: item.title, order: item.order },
          ...collectFolderSources(item.children),
        ]
      : [],
  );

function AddFolderIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M4 6.5h6l2 2h8v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" />
      <path d="M12 12v5" />
      <path d="M9.5 14.5h5" />
    </svg>
  );
}

function AddPageIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4" />
      <path d="M12 11v6" />
      <path d="M9 14h6" />
    </svg>
  );
}

function FolderChevron({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={clsx(
        "h-3.5 w-3.5 transition-transform duration-200",
        isExpanded && "rotate-90",
      )}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function RenameInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      className="min-w-0 flex-1 rounded-sm bg-background px-1 text-sm outline outline-1 outline-accent"
      defaultValue={value}
      onBlur={(event) => onCommit(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onCommit(event.currentTarget.value);
        }
        if (event.key === "Escape") {
          onCommit(value);
        }
      }}
    />
  );
}

function DeleteIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function EditTree({
  nodes,
  parentFolderId,
  expandedIds,
  closingFolderIds,
  selectedPageId,
  renamingId,
  draggingId,
  dragHoverId,
  dropTargetId,
  insertTarget,
  contents,
  frontmatters,
  onToggleFolder,
  onSelectPage,
  onRenameStart,
  onRenameCommit,
  onDeleteNode,
  onDragStart,
  onDragEnd,
  onDragHoverNode,
  onDragInsertNode,
  onDragLeaveNode,
  onDragEnterFolder,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
  onDropNearNode,
}: {
  nodes: EditNode[];
  parentFolderId: string | null;
  expandedIds: Set<string>;
  closingFolderIds: Set<string>;
  selectedPageId: string | null;
  renamingId: string | null;
  draggingId: string | null;
  dragHoverId: string | null;
  dropTargetId: string | null;
  insertTarget: InsertTarget | null;
  contents: Record<string, string>;
  frontmatters: Record<string, string>;
  onToggleFolder: (id: string) => void;
  onSelectPage: (id: string) => void;
  onRenameStart: (id: string) => void;
  onRenameCommit: (id: string, value: string) => void;
  onDeleteNode: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragHoverNode: (id: string) => void;
  onDragInsertNode: (target: InsertTarget) => void;
  onDragLeaveNode: (id: string) => void;
  onDragEnterFolder: (id: string) => void;
  onDragOverFolder: (id: string) => void;
  onDragLeaveFolder: (id: string) => void;
  onDropOnFolder: (id: string) => void;
  onDropNearNode: (target: InsertTarget) => void;
}) {
  const getGapTarget = (event: DragEvent<HTMLUListElement>) =>
    getListGapInsertTarget(
      event.currentTarget,
      event.clientY,
      nodes,
      parentFolderId,
    );

  return (
    <ul
      className="space-y-1"
      onDragOver={(event: DragEvent<HTMLUListElement>) => {
        if (!draggingId) return;
        const target = getGapTarget(event);

        if (!target) return;

        event.preventDefault();
        event.stopPropagation();
        onDragHoverNode(target.id);
        onDragInsertNode(target);
      }}
      onDrop={(event: DragEvent<HTMLUListElement>) => {
        if (!draggingId) return;
        const target = getGapTarget(event);

        if (!target) return;

        event.preventDefault();
        event.stopPropagation();
        onDropNearNode(target);
      }}
    >
      {nodes.map((node, index) => {
        const displayTitle =
          node.type === "page"
            ? (getFrontmatterTitle(frontmatters[node.id] ?? "") ??
              getMarkdownTitle(contents[node.id]) ??
              node.title)
            : node.title;
        const isFolder = node.type === "folder";
        const isExpanded = expandedIds.has(node.id);
        const isClosing = closingFolderIds.has(node.id);
        const shouldRenderChildren =
          isFolder && node.children?.length && (isExpanded || isClosing);
        const isDragging = draggingId === node.id;
        const isHoverTarget = dragHoverId === node.id;
        const isDropTarget = dropTargetId === node.id;
        const insertPosition =
          insertTarget?.id === node.id ? insertTarget.position : null;
        const getSiblingInsertTarget = (
          position: InsertPosition,
        ): InsertTarget => {
          if (position === "before" && index > 0) {
            return { id: nodes[index - 1].id, position: "after" };
          }

          if (
            position === "after" &&
            index === nodes.length - 1 &&
            parentFolderId
          ) {
            return { id: parentFolderId, position: "after" };
          }

          return { id: node.id, position };
        };
        const activateNode = () => {
          if (isFolder) {
            onToggleFolder(node.id);
          } else {
            onSelectPage(node.id);
          }
        };

        return (
          <li
            key={node.id}
            className={clsx(
              "relative",
              shouldRenderChildren && "edit-tree-folder-zone",
              isFolder &&
                isExpanded &&
                isDropTarget &&
                "edit-tree-folder-zone-active",
            )}
            onDragLeave={(event: DragEvent<HTMLLIElement>) => {
              if (!isFolder || !isExpanded) return;
              const nextTarget = event.relatedTarget;

              if (
                nextTarget instanceof Node &&
                event.currentTarget.contains(nextTarget)
              ) {
                return;
              }

              onDragLeaveFolder(node.id);
            }}
            onDragOver={(event: DragEvent<HTMLLIElement>) => {
              if (!isFolder || !isExpanded) return;
              event.preventDefault();
              event.stopPropagation();
              onDragHoverNode(node.id);
              onDragOverFolder(node.id);
            }}
            onDrop={(event: DragEvent<HTMLLIElement>) => {
              if (!isFolder || !isExpanded) return;
              event.preventDefault();
              event.stopPropagation();
              onDropOnFolder(node.id);
            }}
          >
            <div
              draggable
              className="edit-tree-drag-shell group/row relative"
              data-dragging={isDragging ? "true" : undefined}
              data-drop-target={isDropTarget ? "true" : undefined}
              data-hover-target={isHoverTarget ? "true" : undefined}
              onDragEnd={() => onDragEnd()}
              onDragEnter={(event: DragEvent<HTMLDivElement>) => {
                onDragHoverNode(node.id);
                if (!isFolder) return;
                event.stopPropagation();
                onDragEnterFolder(node.id);
              }}
              onDragLeave={(event: DragEvent<HTMLDivElement>) => {
                const nextTarget = event.relatedTarget;
                const containingElement = isFolder
                  ? event.currentTarget.parentElement
                  : event.currentTarget;

                if (
                  nextTarget instanceof Node &&
                  containingElement?.contains(nextTarget)
                ) {
                  return;
                }

                onDragLeaveNode(node.id);
                if (!isFolder) return;
                event.stopPropagation();
                onDragLeaveFolder(node.id);
              }}
              onDragOver={(event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                const offsetRatio = (event.clientY - rect.top) / rect.height;

                if (
                  isFolder &&
                  offsetRatio >= FOLDER_INSERT_EDGE_RATIO &&
                  offsetRatio <= 1 - FOLDER_INSERT_EDGE_RATIO
                ) {
                  onDragHoverNode(node.id);
                  onDragOverFolder(node.id);

                  return;
                }

                const target = getSiblingInsertTarget(
                  offsetRatio < 0.5 ? "before" : "after",
                );

                onDragHoverNode(target.id);
                onDragInsertNode(target);
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                onDragStart(node.id);
              }}
              onDrop={(event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                event.stopPropagation();
                if (insertTarget) {
                  onDropNearNode(insertTarget);

                  return;
                }
                if (isFolder) onDropOnFolder(node.id);
              }}
            >
              {insertPosition === "before" ? (
                <span className="edit-tree-insert-line edit-tree-insert-line-before" />
              ) : null}
              <Button
                fullWidth
                className={clsx(
                  "edit-tree-row group justify-start text-left [&>span]:justify-start",
                  selectedPageId === node.id && "bg-accent/10 text-accent",
                )}
                size="sm"
                variant="tertiary"
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onRenameStart(node.id);
                }}
                onPress={activateNode}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {isFolder ? (
                    <FolderChevron isExpanded={isExpanded} />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-muted/70" />
                  )}
                </span>
                {renamingId === node.id ? (
                  <RenameInput
                    value={displayTitle}
                    onCommit={(value) => onRenameCommit(node.id, value)}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate pr-6 text-left">
                    {displayTitle}
                  </span>
                )}
              </Button>
              <Button
                isIconOnly
                aria-label={isFolder ? "删除文件夹" : "删除页面"}
                className="absolute right-1 top-1/2 h-6 w-6 min-w-6 -translate-y-1/2 text-muted opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100 hover:text-danger"
                size="sm"
                variant="tertiary"
                onPress={() => onDeleteNode(node.id)}
              >
                <DeleteIcon />
              </Button>
              {insertPosition === "after" &&
              !(isFolder && shouldRenderChildren) ? (
                <span className="edit-tree-insert-line edit-tree-insert-line-after" />
              ) : null}
            </div>
            {shouldRenderChildren ? (
              <div
                className="edit-tree-children ml-4 mt-1 border-l border-separator pl-2"
                data-expanded={isExpanded ? "true" : "false"}
              >
                <EditTree
                  closingFolderIds={closingFolderIds}
                  contents={contents}
                  dragHoverId={dragHoverId}
                  draggingId={draggingId}
                  dropTargetId={dropTargetId}
                  expandedIds={expandedIds}
                  frontmatters={frontmatters}
                  insertTarget={insertTarget}
                  nodes={node.children ?? []}
                  parentFolderId={node.id}
                  renamingId={renamingId}
                  selectedPageId={selectedPageId}
                  onDeleteNode={onDeleteNode}
                  onDragEnd={onDragEnd}
                  onDragEnterFolder={onDragEnterFolder}
                  onDragHoverNode={onDragHoverNode}
                  onDragInsertNode={onDragInsertNode}
                  onDragLeaveFolder={onDragLeaveFolder}
                  onDragLeaveNode={onDragLeaveNode}
                  onDragOverFolder={onDragOverFolder}
                  onDragStart={onDragStart}
                  onDropNearNode={onDropNearNode}
                  onDropOnFolder={onDropOnFolder}
                  onRenameCommit={onRenameCommit}
                  onRenameStart={onRenameStart}
                  onSelectPage={onSelectPage}
                  onToggleFolder={onToggleFolder}
                />
              </div>
            ) : null}
            {insertPosition === "after" && isFolder && shouldRenderChildren ? (
              <span className="edit-tree-insert-line edit-tree-insert-line-after" />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ProfileField({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <TextField fullWidth isRequired={required} type={type}>
      <label className="mb-1 flex items-center gap-2 text-sm text-muted">
        <span>{label}</span>
        {required ? <span className="profile-required-tag">必填</span> : null}
      </label>
      <InputGroup className="profile-input-group">
        <InputGroup.Input
          className="profile-input"
          required={required}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </InputGroup>
    </TextField>
  );
}

export function EditDocsLayout({
  docs,
  navItems,
  initialSlug,
}: {
  docs: DocSourceItem[];
  navItems: DocNavNode[];
  initialSlug?: string;
}) {
  const docsBySlug = useMemo(
    () => new Map(docs.map((doc) => [doc.slug, doc])),
    [docs],
  );
  const initialTree = useMemo(
    () => buildTreeFromNav(navItems, docsBySlug),
    [docsBySlug, navItems],
  );
  const initialContents = useMemo(
    () =>
      docs.reduce<Record<string, string>>((acc, doc) => {
        acc[`page:${doc.slug}`] = doc.content;

        return acc;
      }, {}),
    [docs],
  );
  const firstPageId = useMemo(() => {
    const explicit = initialSlug ? `page:${initialSlug}` : null;

    if (explicit && findNode(initialTree, explicit)) return explicit;

    return docs[0] ? `page:${docs[0].slug}` : null;
  }, [docs, initialSlug, initialTree]);
  const initialFrontmatters = useMemo(
    () =>
      docs.reduce<Record<string, string>>((acc, doc) => {
        acc[`page:${doc.slug}`] = doc.frontmatter;

        return acc;
      }, {}),
    [docs],
  );
  const [tree, setTree] = useState<EditNode[]>(initialTree);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(getFolderIds(initialTree)),
  );
  const [closingFolderIds, setClosingFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [contents, setContents] = useState(initialContents);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(
    firstPageId,
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragHoverId, setDragHoverId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null);
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [isSuccessOpen, setIsSuccessOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const hoverTimer = useRef<number | null>(null);
  const pendingAutoExpandId = useRef<string | null>(null);
  const autoExpandedIds = useRef<Set<string>>(new Set());
  const closingTimers = useRef<Map<string, number>>(new Map());

  const selectedNode = selectedPageId ? findNode(tree, selectedPageId) : null;
  const selectedContent = selectedPageId
    ? (contents[selectedPageId] ?? "")
    : "";
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const apiBaseUrl = getApiBaseUrl();

  // --- Backend integration: PR cache, draft restore & diff building ---

  const [cachedPR, setCachedPRState] = useState<CachedPR | null>(null);
  const [frontmatters, setFrontmatters] =
    useState<Record<string, string>>(initialFrontmatters);
  const [committedPaths, setCommittedPaths] = useState<Record<string, string>>(
    {},
  );
  const [knownDraftPrNumber, setKnownDraftPrNumber] = useState<number | null>(
    null,
  );
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    prNumber: number;
    prUrl: string;
    prType: string;
  } | null>(null);
  const initialBodiesRef = useRef<Record<string, string>>({
    ...initialContents,
  });
  const initialFrontmattersRef = useRef<Record<string, string>>({
    ...initialFrontmatters,
  });

  const folderSources = useMemo(
    () => collectFolderSources(navItems),
    [navItems],
  );

  // Overlay changes from a draft PR branch onto the editor state so a
  // returning user resumes exactly where the branch left off.
  const applyPRChanges = (pr: PRChanges) => {
    const bodyUpdates: Record<string, string> = {};
    const fmUpdates: Record<string, string> = {};
    const committed: Record<string, string> = {};
    const removedSlugs: string[] = [];
    const removedFolderSlugs: string[] = [];
    const metaTitles = new Map<string, string>();
    const addedPages: { slug: string; dirSlug: string; title: string }[] = [];

    for (const file of pr.files) {
      const meta = parseMetaPath(file.path);

      if (meta) {
        if (file.status === "removed") {
          removedFolderSlugs.push(meta.dirSlug);
          committed[`folder:${meta.dirSlug}`] = file.path;
          continue;
        }
        try {
          const parsedMeta = JSON.parse(file.content ?? "") as {
            title?: string;
          };

          if (typeof parsedMeta.title === "string") {
            metaTitles.set(meta.dirSlug, parsedMeta.title);
          }
        } catch {
          /* malformed _meta.json on branch */
        }
        committed[`folder:${meta.dirSlug}`] = file.path;
        continue;
      }

      const parsed = parseDocPath(file.path);

      if (!parsed) continue;

      if (file.status === "removed") {
        removedSlugs.push(parsed.slug);
        committed[`page:${parsed.slug}`] = file.path;
        continue;
      }
      if (file.status === "renamed" && file.previousPath) {
        const previous = parseDocPath(file.previousPath);

        if (previous) removedSlugs.push(previous.slug);
      }

      const { frontmatter, body } = splitDocSource(file.content ?? "");
      const id = `page:${parsed.slug}`;

      bodyUpdates[id] = body;
      fmUpdates[id] = frontmatter;
      committed[id] = file.path;

      if (!docsBySlug.has(parsed.slug)) {
        addedPages.push({
          slug: parsed.slug,
          dirSlug: parsed.dirSlug,
          title:
            getFrontmatterTitle(frontmatter) ??
            getMarkdownTitle(body) ??
            parsed.fileSegment,
        });
      }
    }

    setTree((prev) => {
      let next = cloneNodes(prev);

      const ensureFolderChain = (dirSlug: string): string | null => {
        if (!dirSlug) return null;
        let parentId: string | null = null;
        let prefix = "";

        for (const segment of dirSlug.split("/")) {
          prefix = prefix ? `${prefix}/${segment}` : segment;
          const folderId = `folder:${prefix}`;

          if (!findNode(next, folderId)) {
            next = appendNode(next, parentId, {
              id: folderId,
              type: "folder",
              title: metaTitles.get(prefix) ?? segment,
              parentId,
              slug: prefix,
              children: [],
            });
          }
          parentId = folderId;
        }

        return parentId;
      };

      for (const slug of removedSlugs) {
        [next] = removeNode(next, `page:${slug}`);
      }

      for (const slug of removedFolderSlugs) {
        [next] = removeNode(next, `folder:${slug}`);
      }

      for (const dirSlug of metaTitles.keys()) {
        ensureFolderChain(dirSlug);
      }

      for (const page of addedPages) {
        if (findNode(next, `page:${page.slug}`)) continue;
        const parentId = ensureFolderChain(page.dirSlug);

        next = appendNode(next, parentId, {
          id: `page:${page.slug}`,
          type: "page",
          title: page.title,
          parentId,
          slug: page.slug,
        });
      }

      for (const [dirSlug, title] of metaTitles) {
        next = updateNodeTitle(next, `folder:${dirSlug}`, title);
      }

      return next;
    });
    setContents((prev) => ({ ...prev, ...bodyUpdates }));
    setFrontmatters((prev) => ({ ...prev, ...fmUpdates }));
    setCommittedPaths((prev) => ({ ...prev, ...committed }));
    setUploadedImages((prev) => [...new Set([...prev, ...pr.images])]);
    setExpandedIds((prev) => {
      const next = new Set(prev);

      for (const page of addedPages) {
        let prefix = "";

        for (const segment of page.dirSlug ? page.dirSlug.split("/") : []) {
          prefix = prefix ? `${prefix}/${segment}` : segment;
          next.add(`folder:${prefix}`);
        }
      }

      return next;
    });
  };

  const applyPRChangesRef = useRef(applyPRChanges);

  applyPRChangesRef.current = applyPRChanges;

  // On mount: refresh baselines from the live main branch (the static build
  // may be stale) and restore the cached draft PR, if any.
  useEffect(() => {
    if (!apiBaseUrl) return;

    let cancelled = false;

    const refreshFromMain = async () => {
      const listing = await fetchDocsListing();
      const files = await Promise.all(
        listing.files
          .filter((file) => file.path.endsWith(".md"))
          .map(async (file) => {
            const res = await fetch(`${listing.rawBase}/${file.path}`);

            if (!res.ok) return null;

            return { path: file.path, source: await res.text() };
          }),
      );

      if (cancelled) return;

      const bodyUpdates: Record<string, string> = {};
      const fmUpdates: Record<string, string> = {};

      for (const file of files) {
        if (!file) continue;
        const parsed = parseDocPath(file.path);

        if (!parsed) continue;
        const id = `page:${parsed.slug}`;

        if (!(id in initialBodiesRef.current)) continue;
        const { frontmatter, body } = splitDocSource(file.source);

        bodyUpdates[id] = body;
        fmUpdates[id] = frontmatter;
      }

      // Move untouched pages to the fresh baseline so submissions diff
      // against the live main branch instead of the build snapshot.
      setContents((prev) => {
        const next = { ...prev };

        for (const [id, body] of Object.entries(bodyUpdates)) {
          if (prev[id] === initialBodiesRef.current[id]) next[id] = body;
        }

        return next;
      });
      setFrontmatters((prev) => {
        const next = { ...prev };

        for (const [id, fm] of Object.entries(fmUpdates)) {
          if (prev[id] === initialFrontmattersRef.current[id]) next[id] = fm;
        }

        return next;
      });
      initialBodiesRef.current = {
        ...initialBodiesRef.current,
        ...bodyUpdates,
      };
      initialFrontmattersRef.current = {
        ...initialFrontmattersRef.current,
        ...fmUpdates,
      };
    };

    const restoreDraft = async () => {
      const cached = readCachedPR();

      if (!cached) return;
      setCachedPRState(cached);
      if (cached.profile) {
        setProfile(cached.profile);
      }

      try {
        const pr = await fetchPRChanges(cached.prNumber, cached.email);

        if (cancelled) return;
        applyPRChangesRef.current(pr);
        setKnownDraftPrNumber(cached.prNumber);
        setSyncNotice(`已恢复暂存 PR #${cached.prNumber} 的草稿内容。`);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status !== 429) {
          // PR closed, merged or no longer accessible: start fresh.
          clearCachedPR();
          setCachedPRState(null);
          setKnownDraftPrNumber(null);
          setSyncNotice("之前的暂存 PR 已关闭或失效，已为你重新开始。");
        } else {
          setSyncNotice("无法连接后端，暂存内容恢复失败，请稍后刷新重试。");
        }
      }
    };

    (async () => {
      try {
        await refreshFromMain();
      } catch {
        /* backend or network down: keep build-time content */
      }
      if (!cancelled) await restoreDraft();
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  const buildEditorChanges = (): ChangeSet =>
    buildChanges({
      tree,
      docs,
      folders: folderSources,
      contents,
      frontmatters,
      initialContents: initialBodiesRef.current,
      initialFrontmatters: initialFrontmattersRef.current,
      committedPaths,
      uploadedImages,
    });

  // Recomputed when the submit dialog opens, to drive the empty-change guard.
  const pendingChanges = useMemo(
    () => (isSubmitOpen ? buildEditorChanges() : null),

    [
      isSubmitOpen,
      tree,
      contents,
      frontmatters,
      committedPaths,
      uploadedImages,
    ],
  );

  const normalizedProfileEmail = normalizeEmail(profile.email);
  const hasKnownDraft =
    cachedPR !== null &&
    cachedPR.email === normalizedProfileEmail &&
    knownDraftPrNumber === cachedPR.prNumber;
  const isSameUser =
    cachedPR !== null && cachedPR.email === normalizedProfileEmail;

  const submitToBackend = (
    mode: "draft" | "ready",
    changeSet: ChangeSet,
  ): Promise<SubmitResult> => {
    const payload: ChangesPayload = {
      modified: changeSet.modified,
      created: changeSet.created,
      deleted: changeSet.deleted,
      images: changeSet.images,
    };

    if (cachedPR && isSameUser) {
      return updatePR(
        cachedPR.prNumber,
        normalizedProfileEmail,
        payload,
        mode === "ready",
      );
    }

    const create = mode === "draft" ? createDraftPR : createReadyPR;

    return create(
      {
        studentId: profile.studentId.trim(),
        name: profile.name.trim(),
        email: normalizedProfileEmail,
        qq: profile.qq.trim() || undefined,
        github: profile.github.trim() || undefined,
      },
      payload,
    );
  };

  const handleDiscard = async () => {
    if (!cachedPR) return;
    setIsDiscarding(true);

    try {
      await discardPR(cachedPR.prNumber, cachedPR.email);
    } catch {
      /* backend unreachable; still drop the local cache */
    }

    clearCachedPR();
    setCachedPRState(null);
    setKnownDraftPrNumber(null);
    setCommittedPaths({});
    setUploadedImages([]);
    setSyncNotice(null);
    setIsDiscarding(false);
    setIsSuccessOpen(false);
  };

  const handleImageUploaded = (filename: string) => {
    setUploadedImages((prev) =>
      prev.includes(filename) ? prev : [...prev, filename],
    );
  };

  const clearHoverTimer = () => {
    if (!hoverTimer.current) return;

    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    pendingAutoExpandId.current = null;
  };

  const clearClosingTimer = (id: string) => {
    const timer = closingTimers.current.get(id);

    if (!timer) return;

    window.clearTimeout(timer);
    closingTimers.current.delete(id);
  };

  const openFolder = (id: string) => {
    clearClosingTimer(id);
    setClosingFolderIds((ids) => {
      if (!ids.has(id)) return ids;

      const nextIds = new Set(ids);

      nextIds.delete(id);

      return nextIds;
    });
    setExpandedIds((ids) => new Set(ids).add(id));
  };

  const closeFolderWithAnimation = (id: string) => {
    clearClosingTimer(id);
    setExpandedIds((ids) => {
      if (!ids.has(id)) return ids;

      const nextIds = new Set(ids);

      nextIds.delete(id);

      return nextIds;
    });
    setClosingFolderIds((ids) => new Set(ids).add(id));
    closingTimers.current.set(
      id,
      window.setTimeout(() => {
        setClosingFolderIds((ids) => {
          const nextIds = new Set(ids);

          nextIds.delete(id);

          return nextIds;
        });
        closingTimers.current.delete(id);
      }, 260),
    );
  };

  const collapseAutoExpanded = (id?: string) => {
    const idsToCollapse = id
      ? autoExpandedIds.current.has(id)
        ? [id]
        : []
      : Array.from(autoExpandedIds.current);

    if (!idsToCollapse.length) return;

    idsToCollapse.forEach((item) => {
      autoExpandedIds.current.delete(item);
      closeFolderWithAnimation(item);
    });
  };

  const scheduleAutoExpand = (id: string) => {
    if (expandedIds.has(id)) return;
    if (pendingAutoExpandId.current === id) return;

    clearHoverTimer();
    pendingAutoExpandId.current = id;
    hoverTimer.current = window.setTimeout(() => {
      clearClosingTimer(id);
      setClosingFolderIds((ids) => {
        if (!ids.has(id)) return ids;

        const nextIds = new Set(ids);

        nextIds.delete(id);

        return nextIds;
      });
      setExpandedIds((ids) => {
        if (ids.has(id)) return ids;

        const nextIds = new Set(ids);

        nextIds.add(id);
        autoExpandedIds.current.add(id);

        return nextIds;
      });
      hoverTimer.current = null;
      pendingAutoExpandId.current = null;
    }, 420);
  };

  const clearDragState = (keepAutoExpandedId?: string | null) => {
    clearHoverTimer();
    if (keepAutoExpandedId) autoExpandedIds.current.delete(keepAutoExpandedId);
    collapseAutoExpanded();
    setDraggingId(null);
    setDragHoverId(null);
    setDropTargetId(null);
    setInsertTarget(null);
  };

  const addFolder = () => {
    const id = `draft-folder-${Date.now()}`;

    setTree((nodes) => [
      ...nodes,
      {
        id,
        type: "folder",
        title: "Untitled Folder",
        parentId: null,
        children: [],
        isDraft: true,
      },
    ]);
    setExpandedIds((ids) => new Set(ids).add(id));
    setRenamingId(id);
  };

  const addPage = () => {
    const id = `draft-page-${Date.now()}`;

    setTree((nodes) => [
      ...nodes,
      {
        id,
        type: "page",
        title: "Untitled Page",
        parentId: null,
        content: "# Untitled Page\n\n",
        isDraft: true,
      },
    ]);
    setContents((items) => ({ ...items, [id]: "# Untitled Page\n\n" }));
    setSelectedPageId(id);
    setRenamingId(id);
  };

  const moveNode = (targetFolderId: string | null) => {
    if (!draggingId || draggingId === targetFolderId) {
      clearDragState();

      return;
    }
    if (targetFolderId && isDescendant(tree, draggingId, targetFolderId)) {
      clearDragState();

      return;
    }

    setTree((nodes) => {
      const [withoutDragged, draggedNode] = removeNode(
        cloneNodes(nodes),
        draggingId,
      );

      if (!draggedNode) return nodes;

      return appendNode(withoutDragged, targetFolderId, draggedNode);
    });
    clearDragState(targetFolderId);
  };

  const moveNodeNear = (target: InsertTarget) => {
    if (!draggingId || draggingId === target.id) {
      clearDragState();

      return;
    }
    if (isDescendant(tree, draggingId, target.id)) {
      clearDragState();

      return;
    }

    setTree((nodes) => {
      const [withoutDragged, draggedNode] = removeNode(
        cloneNodes(nodes),
        draggingId,
      );

      if (!draggedNode) return nodes;

      return insertNodeNear(
        withoutDragged,
        target.id,
        target.position,
        draggedNode,
      );
    });
    clearDragState();
  };

  const validateProfile = (): boolean => {
    if (
      !profile.studentId.trim() ||
      !profile.name.trim() ||
      !profile.email.trim()
    )
      return false;
    if (!profile.qq.trim() && !profile.github.trim()) return false;

    return true;
  };

  const handleSubmit = async (mode: "draft" | "ready") => {
    if (!validateProfile()) {
      setSubmitError("请填写学号、姓名、邮箱，并至少提供 QQ 或 GitHub 之一。");

      return;
    }
    if (!apiBaseUrl) {
      setSubmitError("后端服务未配置 (NEXT_PUBLIC_API_BASE_URL 为空)");

      return;
    }

    const changeSet = buildEditorChanges();
    // Existing drafts may need an "empty" update to project the branch back
    // onto main after the user reverts every visible edit.
    const reconcileOnly = mode === "draft" && hasKnownDraft;
    const promoteOnly = mode === "ready" && hasKnownDraft;

    if (!changeSet.hasChanges && !promoteOnly && !reconcileOnly) {
      setSubmitError("没有检测到任何改动。");

      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitToBackend(mode, changeSet);

      if (result.promoteFailed) {
        setSubmitError(
          "文件已更新，但转为正式 PR 失败，请稍后重试。暂存数据未清除。",
        );

        return;
      }

      setCommittedPaths((prev) => ({ ...prev, ...changeSet.pathsByNodeId }));
      setLastResult({
        prNumber: result.prNumber,
        prUrl: result.prUrl,
        prType: mode,
      });

      if (mode === "draft" && result.prNumber) {
        const cache: CachedPR = {
          prNumber: result.prNumber,
          type: "draft",
          email: normalizedProfileEmail,
          profile: normalizeCachedProfile({
            studentId: profile.studentId,
            name: profile.name,
            email: normalizedProfileEmail,
            qq: profile.qq,
            github: profile.github,
          }),
        };

        writeCachedPR(cache);
        setCachedPRState(cache);
        setKnownDraftPrNumber(result.prNumber);
      } else if (mode === "ready") {
        clearCachedPR();
        setCachedPRState(null);
        setKnownDraftPrNumber(null);
        setCommittedPaths({});
        setUploadedImages([]);
        setSyncNotice(null);
      }

      setIsSubmitOpen(false);
      setIsSuccessOpen(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteNode = (id: string) => {
    const node = findNode(tree, id);

    if (!node) return;
    const label =
      node.type === "folder"
        ? `文件夹「${node.title}」及其全部内容`
        : `页面「${node.title}」`;

    if (!window.confirm(`确定删除${label}？提交后将从站点移除。`)) return;

    setTree((prev) => removeNode(cloneNodes(prev), id)[0]);
    if (
      selectedPageId &&
      (id === selectedPageId || isDescendant(tree, id, selectedPageId))
    ) {
      setSelectedPageId(null);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <Head />
      <header className="sticky top-0 z-50 grid h-16 grid-cols-3 items-center border-b border-separator bg-background/95 px-4 backdrop-blur-lg sm:px-6">
        <div className="min-w-0">
          <NavbarBrand basePath={basePath} />
        </div>
        <div className="flex justify-center">
          <span className="rounded-md bg-purple-600 px-3 py-1 text-sm font-medium text-white">
            edit mode
          </span>
        </div>
        <div className="flex items-center justify-end gap-2">
          <NavbarActions basePath={basePath} className="hidden sm:flex" />
          {cachedPR && (
            <span className="hidden text-xs text-amber-500 sm:inline">
              Draft #{cachedPR.prNumber}
            </span>
          )}
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              setSubmitError(null);
              setLastResult(null);
              setIsSubmitOpen(true);
            }}
          >
            submit
          </Button>
        </div>
      </header>
      {syncNotice && (
        <div className="flex items-center justify-center gap-3 border-b border-separator bg-accent/5 px-4 py-2 text-xs text-muted">
          <span>{syncNotice}</span>
          <button
            className="underline underline-offset-2"
            type="button"
            onClick={() => setSyncNotice(null)}
          >
            知道了
          </button>
        </div>
      )}
      <main className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="docs-sidebar-shell lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:self-start">
          <div className="docs-sidebar h-full overflow-y-auto border-r border-separator bg-background/80 p-3 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-end gap-1">
              <Button
                isIconOnly
                aria-label="Add folder"
                size="sm"
                variant="tertiary"
                onPress={addFolder}
              >
                <AddFolderIcon />
              </Button>
              <Button
                isIconOnly
                aria-label="Add page"
                size="sm"
                variant="tertiary"
                onPress={addPage}
              >
                <AddPageIcon />
              </Button>
            </div>
            <div
              className="min-h-[calc(100vh-8rem)]"
              onDragOver={(event) => {
                event.preventDefault();
                setDropTargetId(null);
                setInsertTarget(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                moveNode(null);
              }}
            >
              <EditTree
                closingFolderIds={closingFolderIds}
                contents={contents}
                dragHoverId={dragHoverId}
                draggingId={draggingId}
                dropTargetId={dropTargetId}
                expandedIds={expandedIds}
                frontmatters={frontmatters}
                insertTarget={insertTarget}
                nodes={tree}
                parentFolderId={null}
                renamingId={renamingId}
                selectedPageId={selectedPageId}
                onDeleteNode={deleteNode}
                onDragEnd={clearDragState}
                onDragEnterFolder={(id) => {
                  setDragHoverId(id);
                  setDropTargetId(id);
                  setInsertTarget(null);
                  scheduleAutoExpand(id);
                }}
                onDragHoverNode={setDragHoverId}
                onDragInsertNode={(target) => {
                  clearHoverTimer();
                  setDropTargetId(null);
                  setInsertTarget(target);
                }}
                onDragLeaveFolder={(id) => {
                  clearHoverTimer();
                  setDropTargetId((current) =>
                    current === id ? null : current,
                  );
                  collapseAutoExpanded(id);
                }}
                onDragLeaveNode={(id) => {
                  setDragHoverId((current) =>
                    current === id ? null : current,
                  );
                  setInsertTarget((current) =>
                    current?.id === id ? null : current,
                  );
                }}
                onDragOverFolder={(id) => {
                  setDropTargetId(id);
                  setInsertTarget(null);
                  scheduleAutoExpand(id);
                }}
                onDragStart={(id) => {
                  setDraggingId(id);
                  setDragHoverId(null);
                  setInsertTarget(null);
                }}
                onDropNearNode={moveNodeNear}
                onDropOnFolder={(id) => moveNode(id)}
                onRenameCommit={(id, value) => {
                  const title = value.trim() || "Untitled";
                  const node = findNode(tree, id);
                  const displayed =
                    node?.type === "page"
                      ? (getFrontmatterTitle(frontmatters[id] ?? "") ??
                        getMarkdownTitle(contents[id]) ??
                        node.title)
                      : node?.title;

                  setTree((nodes) => updateNodeTitle(nodes, id, title));
                  // Page titles live in frontmatter (matching how the site
                  // renders them); file paths are not affected by renames.
                  if (node?.type === "page" && title !== displayed) {
                    setFrontmatters((prev) => ({
                      ...prev,
                      [id]: withFrontmatterTitle(prev[id] ?? "", title),
                    }));
                  }
                  setRenamingId(null);
                }}
                onRenameStart={setRenamingId}
                onSelectPage={setSelectedPageId}
                onToggleFolder={(id) => {
                  autoExpandedIds.current.delete(id);
                  if (expandedIds.has(id)) {
                    closeFolderWithAnimation(id);
                  } else {
                    openFolder(id);
                  }
                }}
              />
            </div>
          </div>
        </aside>
        <article className="min-w-0 px-6 py-8 lg:px-10 lg:py-10">
          {selectedNode?.type === "page" && selectedPageId ? (
            <div
              key={selectedPageId}
              className="edit-doc-panel flex h-full flex-col gap-4"
            >
              <header className="border-b border-separator pb-4">
                <h1 className="text-2xl font-medium">
                  {getFrontmatterTitle(frontmatters[selectedPageId] ?? "") ??
                    getMarkdownTitle(selectedContent) ??
                    selectedNode.title}
                </h1>
                <p className="mt-2 text-sm text-muted">
                  编辑内容不会自动保存，请通过「暂存」生成 Draft PR
                  后随时回来继续编辑；上传的图片请在 24 小时内暂存或提交，
                  否则将被自动清理。
                </p>
              </header>
              <MarkdownEditor
                value={selectedContent}
                onChange={(value) => {
                  setContents((items) => ({
                    ...items,
                    [selectedPageId]: value,
                  }));
                }}
                onImageUploaded={handleImageUploaded}
              />
            </div>
          ) : (
            <div
              key="empty"
              className="edit-doc-panel flex min-h-[40vh] items-center justify-center text-muted"
            >
              Select a page to start editing.
            </div>
          )}
        </article>
      </main>

      <Modal.Root isOpen={isSubmitOpen} onOpenChange={setIsSubmitOpen}>
        <Modal.Backdrop>
          <Modal.Container size="lg">
            <Modal.Dialog>
              <Form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmit("ready");
                }}
              >
                <Modal.Header>
                  <Modal.Heading>提交信息</Modal.Heading>
                  <Modal.CloseTrigger />
                </Modal.Header>
                <Modal.Body className="grid gap-4">
                  {cachedPR && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
                      已有暂存 PR #{cachedPR.prNumber}。暂存将更新该
                      PR，正式提交将转为 Ready 状态。
                    </div>
                  )}

                  {pendingChanges &&
                    !pendingChanges.hasChanges &&
                    !hasKnownDraft && (
                      <div className="rounded-md border border-separator bg-muted/5 px-4 py-3 text-sm text-muted">
                        当前没有任何改动可提交。
                      </div>
                    )}

                  {submitError && (
                    <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                      提交失败：{submitError}
                    </div>
                  )}
                  <ProfileField
                    required
                    label="学号"
                    value={profile.studentId}
                    onChange={(value) =>
                      setProfile((current) => ({
                        ...current,
                        studentId: value,
                      }))
                    }
                  />
                  <ProfileField
                    required
                    label="姓名"
                    value={profile.name}
                    onChange={(value) =>
                      setProfile((current) => ({ ...current, name: value }))
                    }
                  />
                  <ProfileField
                    required
                    label="邮箱"
                    type="email"
                    value={profile.email}
                    onChange={(value) =>
                      setProfile((current) => ({ ...current, email: value }))
                    }
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ProfileField
                      label="QQ"
                      value={profile.qq}
                      onChange={(value) =>
                        setProfile((current) => ({ ...current, qq: value }))
                      }
                    />
                    <ProfileField
                      label="GitHub"
                      value={profile.github}
                      onChange={(value) =>
                        setProfile((current) => ({ ...current, github: value }))
                      }
                    />
                  </div>
                  {!profile.qq.trim() && !profile.github.trim() && (
                    <p className="text-sm text-danger">
                      QQ 和 GitHub 至少填写一个。
                    </p>
                  )}
                </Modal.Body>
                <Modal.Footer className="flex flex-wrap gap-2">
                  {cachedPR && (
                    <Button
                      className="text-danger hover:text-danger"
                      isDisabled={isSubmitting || isDiscarding}
                      variant="tertiary"
                      onPress={handleDiscard}
                    >
                      {isDiscarding ? "处理中..." : "放弃暂存"}
                    </Button>
                  )}
                  <Button
                    isDisabled={
                      isSubmitting ||
                      Boolean(
                        pendingChanges &&
                          !pendingChanges.hasChanges &&
                          !hasKnownDraft,
                      )
                    }
                    variant="secondary"
                    onPress={() => handleSubmit("draft")}
                  >
                    {isSubmitting
                      ? "提交中..."
                      : cachedPR
                        ? "更新暂存"
                        : "暂存 (Draft PR)"}
                  </Button>
                  <Button
                    isDisabled={
                      isSubmitting ||
                      Boolean(
                        pendingChanges &&
                          !pendingChanges.hasChanges &&
                          !hasKnownDraft,
                      )
                    }
                    type="submit"
                    variant="primary"
                  >
                    {isSubmitting ? "提交中..." : "正式提交"}
                  </Button>
                </Modal.Footer>
              </Form>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>

      <Modal.Root isOpen={isSuccessOpen} onOpenChange={setIsSuccessOpen}>
        <Modal.Backdrop>
          <Modal.Container size="sm">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>
                  {lastResult?.prType === "draft" ? "暂存成功" : "提交成功"}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="grid gap-4">
                <p className="leading-8 text-muted">
                  {lastResult?.prType === "draft"
                    ? "您的更改已暂存为 Draft PR，可继续编辑后再次暂存或正式提交。"
                    : "您的更改已提交，等待项目维护者审核合并。"}
                </p>
                {lastResult?.prUrl && (
                  <a
                    className="inline-flex items-center gap-2 text-sm text-accent underline underline-offset-2"
                    href={lastResult.prUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    查看 PR #{lastResult.prNumber} →
                  </a>
                )}
              </Modal.Body>
              <Modal.Footer className="flex flex-wrap gap-2">
                {lastResult?.prType === "draft" && (
                  <Button
                    className="text-danger hover:text-danger"
                    isDisabled={isDiscarding}
                    variant="tertiary"
                    onPress={handleDiscard}
                  >
                    {isDiscarding ? "处理中..." : "放弃暂存"}
                  </Button>
                )}
                {lastResult?.prType === "draft" ? (
                  <>
                    <Button
                      variant="secondary"
                      onPress={() => {
                        window.location.href = `${basePath}/docs`;
                      }}
                    >
                      返回文档（主站）
                    </Button>
                    <Button
                      variant="primary"
                      onPress={() => setIsSuccessOpen(false)}
                    >
                      继续编辑
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    onPress={() => {
                      window.location.href = `${basePath}/docs`;
                    }}
                  >
                    返回文档
                  </Button>
                )}
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </div>
  );
}
