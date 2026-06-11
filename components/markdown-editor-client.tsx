import { useMemo, useRef } from "react";
import { Button } from "@heroui/react";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  headingsPlugin,
  iconComponentFor$,
  imagePlugin,
  insertImage$,
  lexicalTheme,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  type MDXEditorMethods,
  quotePlugin,
  readOnly$,
  Separator,
  thematicBreakPlugin,
  InsertThematicBreak,
  toolbarPlugin,
  UndoRedo,
  useCellValues,
  usePublisher,
} from "@mdxeditor/editor";

type MarkdownEditorClientProps = {
  value: string;
  onChange: (value: string) => void;
};

const imageUploadHandler = (image: File) =>
  new Promise<string>((resolve, reject) => {
    if (!image.type.startsWith("image/")) {
      reject(new Error("Only image files can be uploaded."));

      return;
    }

    const reader = new FileReader();

    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read image."));
      }
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(image);
  });

function ImageUploadButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const insertImage = usePublisher(insertImage$);
  const [readOnly, iconComponentFor] = useCellValues(
    readOnly$,
    iconComponentFor$,
  );

  return (
    <>
      <Button
        isIconOnly
        aria-label="Upload image"
        className="markdown-editor-upload-button"
        isDisabled={readOnly}
        size="sm"
        type="button"
        variant="tertiary"
        onPress={() => inputRef.current?.click()}
      >
        {iconComponentFor("add_photo")}
      </Button>
      <input
        ref={inputRef}
        accept="image/*"
        className="sr-only"
        type="file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];

          if (!file) return;

          insertImage({ file });
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}

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
            <ImageUploadButton />
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
