# Tongji Walkthrough

Static walkthrough site for Tongji University, built with Next.js, Bun, and
HeroUI v3.

## Local Development

```bash
bun install
bun run dev
```

## Build

```bash
bun run build
```

The static output is generated in `out`.

## Editing Docs

Only edit Markdown files under `content/docs` when adding or changing docs.
Each `.md` file becomes a Docs page, and the left sidebar is generated at build
time.

Use frontmatter to control the sidebar:

```md
---
title: Campus Notes
description: Practical notes for campus life.
order: 2
---
```

GitHub Pages deployment is handled by `.github/workflows/pages.yml`.
