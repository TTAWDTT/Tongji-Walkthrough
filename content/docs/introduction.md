---
title: Introduction
description: Start here when editing the walkthrough.
order: 1
---

## How this docs section works

Every Markdown file in `content/docs` becomes one page in the Docs section.

- The left sidebar is generated from the Markdown files automatically.
- Use frontmatter to set `title`, `description`, and `order`.
- Nested folders are supported, and their paths become nested doc URLs.

## Editing pattern

Create or edit a `.md` file in `content/docs`, then run:

```bash
bun run build
```

After the next GitHub Pages deployment, the page and sidebar will update.
