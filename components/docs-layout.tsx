import type { DocPageData } from "@/lib/docs";
import type { CSSProperties } from "react";

import { useState } from "react";
import NextLink from "next/link";
import clsx from "clsx";
import { Button } from "@heroui/react";

function SidebarToggleIcon({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={clsx(
        "h-4 w-4 transition-transform duration-300 ease-out",
        isCollapsed && "rotate-180",
      )}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function DocsLayout({ doc }: { doc: DocPageData }) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const layoutStyle = {
    "--docs-sidebar-width": isSidebarCollapsed ? "4.5rem" : "15rem",
  } as CSSProperties;

  return (
    <section
      className="docs-shell grid gap-8 py-8 lg:grid-cols-[var(--docs-sidebar-width)_minmax(0,1fr)] lg:py-10"
      style={layoutStyle}
    >
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div
          className={clsx(
            "docs-sidebar rounded-lg border border-separator bg-background/65 p-2 backdrop-blur-md",
            isSidebarCollapsed && "lg:px-2",
          )}
        >
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <span
              className={clsx(
                "overflow-hidden text-sm font-medium text-muted transition-[max-width,opacity,transform] duration-300 ease-out",
                isSidebarCollapsed
                  ? "lg:max-w-0 lg:translate-x-2 lg:opacity-0"
                  : "max-w-28 opacity-100",
              )}
            >
              Docs
            </span>
            <Button
              isIconOnly
              aria-label={
                isSidebarCollapsed
                  ? "Expand docs sidebar"
                  : "Collapse docs sidebar"
              }
              className="shrink-0"
              size="sm"
              variant="tertiary"
              onPress={() => setIsSidebarCollapsed((value) => !value)}
            >
              <SidebarToggleIcon isCollapsed={isSidebarCollapsed} />
            </Button>
          </div>

          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {doc.navItems.map((item, index) => (
              <NextLink
                key={item.slug}
                aria-current={item.slug === doc.slug ? "page" : undefined}
                className={clsx(
                  "docs-nav-link group relative flex shrink-0 items-center gap-2 overflow-hidden rounded-md px-3 py-2 text-sm no-underline",
                  item.slug === doc.slug
                    ? "bg-accent/10 text-accent"
                    : "text-muted hover:bg-surface hover:text-foreground",
                  isSidebarCollapsed && "lg:justify-center lg:px-2",
                )}
                href={item.href}
                style={{ "--docs-item-index": index } as CSSProperties}
                title={item.title}
              >
                <span
                  className={clsx(
                    "h-1.5 w-1.5 shrink-0 rounded-full transition-[background,transform] duration-300 ease-out",
                    item.slug === doc.slug
                      ? "scale-125 bg-accent"
                      : "bg-muted/50 group-hover:bg-foreground/60",
                  )}
                />
                <span
                  className={clsx(
                    "truncate transition-[max-width,opacity,transform] duration-300 ease-out",
                    isSidebarCollapsed
                      ? "lg:max-w-0 lg:translate-x-2 lg:opacity-0"
                      : "max-w-48 opacity-100",
                  )}
                >
                  {item.title}
                </span>
              </NextLink>
            ))}
          </nav>
        </div>
      </aside>

      <article key={doc.slug} className="docs-content-enter min-w-0">
        <header className="border-b border-separator pb-6">
          <h1 className="text-3xl font-medium leading-tight md:text-4xl">
            {doc.title}
          </h1>
          {doc.description && (
            <p className="mt-3 max-w-2xl text-muted leading-8">
              {doc.description}
            </p>
          )}
        </header>
        <div
          dangerouslySetInnerHTML={{ __html: doc.contentHtml }}
          className="docs-markdown mt-8 max-w-3xl"
        />
      </article>
    </section>
  );
}
