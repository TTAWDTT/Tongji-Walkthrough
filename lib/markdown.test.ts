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
});
