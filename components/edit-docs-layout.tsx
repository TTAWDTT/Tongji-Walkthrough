import type { DragEvent, FormEvent } from "react";
import type { DocSourceItem } from "@/lib/docs";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Form,
  InputGroup,
  Modal,
  TextArea,
  TextField,
} from "@heroui/react";
import clsx from "clsx";

import { Head } from "@/layouts/head";
import { NavbarActions, NavbarBrand } from "@/components/navbar";

type NodeType = "folder" | "page";

type EditNode = {
  id: string;
  type: NodeType;
  title: string;
  parentId: string | null;
  children?: EditNode[];
  content?: string;
  isDraft?: boolean;
};

type Profile = {
  studentId: string;
  name: string;
  email: string;
  qq: string;
  github: string;
};

const defaultProfile: Profile = {
  studentId: "",
  name: "",
  email: "",
  qq: "",
  github: "",
};

const formatSegmentTitle = (segment: string) =>
  segment
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

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

const buildTree = (docs: DocSourceItem[]) => {
  const root: EditNode[] = [];
  const folders = new Map<string, EditNode>();

  docs.forEach((doc) => {
    const segments = doc.slug.split("/");
    let parentId: string | null = null;
    let siblings = root;
    let folderPath = "";

    segments.slice(0, -1).forEach((segment) => {
      folderPath = folderPath ? `${folderPath}/${segment}` : segment;
      const folderId = `folder:${folderPath}`;
      let folder = folders.get(folderId);

      if (!folder) {
        folder = {
          id: folderId,
          type: "folder",
          title: formatSegmentTitle(segment),
          parentId,
          children: [],
        };
        folders.set(folderId, folder);
        siblings.push(folder);
      }

      parentId = folder.id;
      siblings = folder.children ?? [];
    });

    siblings.push({
      id: `page:${doc.slug}`,
      type: "page",
      title: doc.title,
      parentId,
      content: doc.content,
    });
  });

  return root;
};

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

function EditTree({
  nodes,
  expandedIds,
  closingFolderIds,
  selectedPageId,
  renamingId,
  draggingId,
  dragHoverId,
  dropTargetId,
  contents,
  onToggleFolder,
  onSelectPage,
  onRenameStart,
  onRenameCommit,
  onDragStart,
  onDragEnd,
  onDragHoverNode,
  onDragLeaveNode,
  onDragEnterFolder,
  onDragOverFolder,
  onDragLeaveFolder,
  onDropOnFolder,
}: {
  nodes: EditNode[];
  expandedIds: Set<string>;
  closingFolderIds: Set<string>;
  selectedPageId: string | null;
  renamingId: string | null;
  draggingId: string | null;
  dragHoverId: string | null;
  dropTargetId: string | null;
  contents: Record<string, string>;
  onToggleFolder: (id: string) => void;
  onSelectPage: (id: string) => void;
  onRenameStart: (id: string) => void;
  onRenameCommit: (id: string, value: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragHoverNode: (id: string) => void;
  onDragLeaveNode: (id: string) => void;
  onDragEnterFolder: (id: string) => void;
  onDragOverFolder: (id: string) => void;
  onDragLeaveFolder: (id: string) => void;
  onDropOnFolder: (id: string) => void;
}) {
  return (
    <ul className="space-y-1">
      {nodes.map((node) => {
        const displayTitle =
          node.type === "page"
            ? (getMarkdownTitle(contents[node.id]) ?? node.title)
            : node.title;
        const isFolder = node.type === "folder";
        const isExpanded = expandedIds.has(node.id);
        const isClosing = closingFolderIds.has(node.id);
        const shouldRenderChildren =
          isFolder && node.children?.length && (isExpanded || isClosing);
        const isDragging = draggingId === node.id;
        const isHoverTarget = dragHoverId === node.id;
        const isDropTarget = dropTargetId === node.id;
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
              className="edit-tree-drag-shell"
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
                onDragHoverNode(node.id);
                if (!isFolder) return;
                event.preventDefault();
                event.stopPropagation();
                onDragOverFolder(node.id);
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                onDragStart(node.id);
              }}
              onDrop={(event: DragEvent<HTMLDivElement>) => {
                if (!isFolder) return;
                event.preventDefault();
                event.stopPropagation();
                onDropOnFolder(node.id);
              }}
            >
              <Button
                fullWidth
                className={clsx(
                  "edit-tree-row group",
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
                    value={node.title}
                    onCommit={(value) => onRenameCommit(node.id, value)}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate">
                    {displayTitle}
                  </span>
                )}
              </Button>
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
                  nodes={node.children ?? []}
                  renamingId={renamingId}
                  selectedPageId={selectedPageId}
                  onDragEnd={onDragEnd}
                  onDragEnterFolder={onDragEnterFolder}
                  onDragHoverNode={onDragHoverNode}
                  onDragLeaveFolder={onDragLeaveFolder}
                  onDragLeaveNode={onDragLeaveNode}
                  onDragOverFolder={onDragOverFolder}
                  onDragStart={onDragStart}
                  onDropOnFolder={onDropOnFolder}
                  onRenameCommit={onRenameCommit}
                  onRenameStart={onRenameStart}
                  onSelectPage={onSelectPage}
                  onToggleFolder={onToggleFolder}
                />
              </div>
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
  initialSlug,
}: {
  docs: DocSourceItem[];
  initialSlug?: string;
}) {
  const initialTree = useMemo(() => buildTree(docs), [docs]);
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

  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !profile.studentId.trim() ||
      !profile.name.trim() ||
      !profile.email.trim()
    )
      return;
    if (!profile.qq.trim() && !profile.github.trim()) return;

    const submissionPayload = { changes: tree, contents, profile };

    void submissionPayload;
    setIsSubmitOpen(false);
    setIsSuccessOpen(true);
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
          <Button
            size="sm"
            variant="primary"
            onPress={() => setIsSubmitOpen(true)}
          >
            submit
          </Button>
        </div>
      </header>
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
              onDragOver={(event) => event.preventDefault()}
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
                nodes={tree}
                renamingId={renamingId}
                selectedPageId={selectedPageId}
                onDragEnd={clearDragState}
                onDragEnterFolder={(id) => {
                  setDragHoverId(id);
                  setDropTargetId(id);
                  scheduleAutoExpand(id);
                }}
                onDragHoverNode={setDragHoverId}
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
                }}
                onDragOverFolder={(id) => {
                  setDropTargetId(id);
                  scheduleAutoExpand(id);
                }}
                onDragStart={(id) => {
                  setDraggingId(id);
                  setDragHoverId(null);
                }}
                onDropOnFolder={(id) => moveNode(id)}
                onRenameCommit={(id, value) => {
                  const title = value.trim() || "Untitled";

                  setTree((nodes) => updateNodeTitle(nodes, id, title));
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
                  {getMarkdownTitle(selectedContent) ?? selectedNode.title}
                </h1>
                <p className="mt-2 text-sm text-muted">
                  Markdown changes are saved locally until you submit.
                </p>
              </header>
              <TextArea
                fullWidth
                className="edit-markdown-area min-h-[60vh] font-mono"
                value={selectedContent}
                onChange={(event) => {
                  const value = event.currentTarget.value;

                  setContents((items) => ({
                    ...items,
                    [selectedPageId]: value,
                  }));
                }}
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
              <Form onSubmit={submitProfile}>
                <Modal.Header>
                  <Modal.Heading>提交信息</Modal.Heading>
                  <Modal.CloseTrigger />
                </Modal.Header>
                <Modal.Body className="grid gap-4">
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
                <Modal.Footer>
                  <Button type="submit" variant="primary">
                    确认提交
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
                <Modal.Heading>提交成功</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="leading-8 text-muted">提交成功，等待审核。</p>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="primary"
                  onPress={() => {
                    window.location.href = "/docs";
                  }}
                >
                  确定
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
    </div>
  );
}
