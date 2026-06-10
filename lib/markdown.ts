const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderInline = (value: string) =>
  escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
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

    const heading = line.match(/^(#{2,3})\s+(.+)$/);

    if (heading) {
      flushList();

      const level = heading[1].length;

      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);

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
