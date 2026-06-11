import { useMemo, useRef } from "react";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  headingsPlugin,
  imagePlugin,
  InsertImage,
  lexicalTheme,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  type MDXEditorMethods,
  quotePlugin,
  Separator,
  thematicBreakPlugin,
  InsertThematicBreak,
  toolbarPlugin,
  UndoRedo,
} from "@mdxeditor/editor";

type MarkdownEditorClientProps = {
  value: string;
  onChange: (value: string) => void;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

const imageUploadHandler = async (image: File): Promise<string> => {
  if (!image.type.startsWith("image/")) {
    throw new Error("Only image files can be uploaded.");
  }

  if (!API_BASE) {
    // Fallback to base64 when no backend is configured
    return new Promise((resolve, reject) => {
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
  }

  const formData = new FormData();
  formData.append("image", image);

  // Retrieve cached PR number to associate image with the draft PR
  const cached = localStorage.getItem("edit_pr_info");
  if (cached) {
    try {
      const info = JSON.parse(cached);
      if (info.prNumber) formData.append("pr_number", String(info.prNumber));
      if (info.email) formData.append("email", info.email);
    } catch {
      /* ignore */
    }
  }

  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error ?? "Image upload failed");
  }

  const data = await res.json();
  return data.markdown;
};

export default function MarkdownEditorClient({
  value,
  onChange,
}: MarkdownEditorClientProps) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const editorLexicalTheme = useMemo(
    () => ({
      ...lexicalTheme,
      heading: {
        h1: "markdown-editor-heading markdown-editor-heading-1",
        h2: "markdown-editor-heading markdown-editor-heading-2",
        h3: "markdown-editor-heading markdown-editor-heading-3",
        h4: "markdown-editor-heading markdown-editor-heading-4",
        h5: "markdown-editor-heading markdown-editor-heading-5",
        h6: "markdown-editor-heading markdown-editor-heading-6",
      },
      list: {
        ...lexicalTheme.list,
        checklist: "markdown-editor-list",
        listitem: "markdown-editor-list-item",
        listitemChecked: "markdown-editor-list-item",
        listitemUnchecked: "markdown-editor-list-item",
        nested: {
          ...lexicalTheme.list?.nested,
          list: "markdown-editor-nested-list",
          listitem: "markdown-editor-list-item",
        },
        ol: "markdown-editor-list markdown-editor-ol",
        olDepth: [
          "markdown-editor-list markdown-editor-ol",
          "markdown-editor-list markdown-editor-ol markdown-editor-list-depth-1",
          "markdown-editor-list markdown-editor-ol markdown-editor-list-depth-2",
        ],
        ul: "markdown-editor-list markdown-editor-ul",
        ulDepth: [
          "markdown-editor-list markdown-editor-ul",
          "markdown-editor-list markdown-editor-ul markdown-editor-list-depth-1",
          "markdown-editor-list markdown-editor-ul markdown-editor-list-depth-2",
        ],
      },
      text: {
        ...lexicalTheme.text,
        code: "markdown-editor-inline-code",
      },
    }),
    [],
  );
  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      imagePlugin({ imageUploadHandler }),
      markdownShortcutPlugin(),
      toolbarPlugin({
        toolbarContents: () => (
          <>
            <UndoRedo />
            <Separator />
            <BlockTypeSelect />
            <Separator />
            <BoldItalicUnderlineToggles />
            <ListsToggle options={["bullet", "number"]} />
            <Separator />
            <CreateLink />
            <InsertImage />
            <Separator />
            <InsertThematicBreak />
          </>
        ),
      }),
    ],
    [],
  );

  return (
    <MDXEditor
      ref={editorRef}
      className="markdown-editor"
      contentEditableClassName="markdown-editor-content"
      lexicalTheme={editorLexicalTheme}
      markdown={value}
      plugins={plugins}
      onChange={onChange}
    />
  );
}
