const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const unescapeMarkdownPunctuation = (value: string) =>
  value.replace(/\\([\\`*{}\[\]()#+\-.!_~<>])/g, "$1");

const isSafeImageSrc = (src: string) =>
  /^(https?:\/\/|\/(?!\/)|\.{0,2}\/)/i.test(src) &&
  !/[\u0000-\u001f]/.test(src);

const readHtmlAttributes = (source: string): Record<string, string> => {
  const attributes: Record<string, string> = {};
  const attributePattern =
    /\s([a-zA-Z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(source))) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  return attributes;
};

const renderImage = ({
  alt = "",
  height,
  src,
  width,
}: {
  alt?: string;
  height?: string;
  src: string;
  width?: string;
}) => {
  const trimmedSrc = src.trim();

  if (!isSafeImageSrc(trimmedSrc)) return escapeHtml(src);

  const sizeAttributes = [
    width && /^\d{1,5}$/.test(width) ? ` width="${width}"` : "",
    height && /^\d{1,5}$/.test(height) ? ` height="${height}"` : "",
  ].join("");

  return `<img src="${escapeHtml(trimmedSrc)}" alt="${escapeHtml(alt)}"${sizeAttributes} loading="lazy" />`;
};

const renderHtmlImage = (source: string) => {
  if (!/^<img\b[^>]*\/?>$/i.test(source.trim())) return null;
  const attributes = readHtmlAttributes(source);

  if (!attributes.src) return escapeHtml(source);

  return renderImage({
    alt: attributes.alt,
    height: attributes.height,
    src: attributes.src,
    width: attributes.width,
  });
};

const renderMarkdownImage = (source: string) => {
  const match = source.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);

  if (!match) return null;

  return renderImage({ alt: match[1], src: match[2] });
};

const renderInline = (value: string) =>
  escapeHtml(unescapeMarkdownPunctuation(value))
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
      (_, alt, src) => renderImage({ alt, src }),
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, "<u>$1</u>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

export const markdownToHtml = (markdown: string) => {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let inCodeBlock = false;

  const flushList = () => {
    if (!listItems.length) return;

    html.push(`<ul>${listItems.join("")}</ul>`);
    listItems = [];
  };

  const flushCode = () => {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }

      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);

      continue;
    }

    if (!line.trim()) {
      flushList();

      continue;
    }

    const blockImage =
      renderHtmlImage(line.trim()) ?? renderMarkdownImage(line.trim());

    if (blockImage) {
      flushList();
      html.push(blockImage);

      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);

    if (heading) {
      flushList();

      const level = heading[1].length;

      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);

      continue;
    }

    const horizontalRule = line.trim().match(/^(\*\s*){3,}$|^(-\s*){3,}$/);

    if (horizontalRule) {
      flushList();
      html.push("<hr />");

      continue;
    }

    const listItem = line.match(/^-\s+(.+)$/);

    if (listItem) {
      listItems.push(`<li>${renderInline(listItem[1])}</li>`);

      continue;
    }

    const quote = line.match(/^>\s+(.+)$/);

    if (quote) {
      flushList();
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);

      continue;
    }

    flushList();
    html.push(`<p>${renderInline(line)}</p>`);
  }

  flushList();

  if (inCodeBlock) {
    flushCode();
  }

  return html.join("\n");
};
