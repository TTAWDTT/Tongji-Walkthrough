import { describe, expect, it } from "bun:test";

import { markdownToHtml } from "./markdown";

describe("markdownToHtml", () => {
  it("renders raw image html from the editor as an image", () => {
    const html = markdownToHtml(
      '<img height="171" width="171" src="https://tongjione.yzxoi.top/api/image?id=upload.jpg" />',
    );

    expect(html).toContain("<img");
    expect(html).toContain(
      'src="https://tongjione.yzxoi.top/api/image?id=upload.jpg"',
    );
    expect(html).toContain('width="171"');
    expect(html).toContain('height="171"');
    expect(html).not.toContain("&lt;img");
  });

  it("renders markdown images and rejects script urls", () => {
    expect(markdownToHtml("![Logo](/images/logo.png)")).toContain(
      '<img src="/images/logo.png" alt="Logo"',
    );
    expect(markdownToHtml("![x](javascript:alert(1))")).not.toContain("<img");
  });

  it("renders editor markdown syntax instead of showing source text", () => {
    const html = markdownToHtml(
      [
        "你好\\~",
        "# 我弄个图片试试 🤫 \\<--这是测试emoji",
        "***",
        "<u>*不错不错*</u>",
        "##### 有没有容易出错的。",
      ].join("\n\n"),
    );

    expect(html).toContain("<h1>");
    expect(html).toContain("你好~");
    expect(html).toContain("&lt;--这是测试emoji");
    expect(html).toContain("<hr />");
    expect(html).toContain("<u><em>不错不错</em></u>");
    expect(html).toContain("<h5>");
    expect(html).not.toContain("<p># ");
    expect(html).not.toContain("<p>***</p>");
  });
});
