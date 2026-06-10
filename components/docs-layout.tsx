import type { DocPageData } from "@/lib/docs";
import type { CSSProperties } from "react";

import { useState } from "react";
import clsx from "clsx";
import { Button } from "@heroui/react";

import { SmoothLink } from "@/components/smooth-link";
import { DocsEditEntry } from "@/components/docs-edit-entry";

function SidebarToggleIcon() {
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
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
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
      className="docs-shell grid min-h-[calc(100vh-4rem)] lg:grid-cols-[var(--docs-sidebar-width)_minmax(0,1fr)]"
      style={layoutStyle}
    >
      <aside className="docs-sidebar-shell lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:self-start">
        <div
          className={clsx(
            "docs-sidebar h-full border-r border-separator bg-background/80 p-3 backdrop-blur-md",
            isSidebarCollapsed && "lg:px-2",
          )}
        >
          <div
            className={clsx(
              "flex pb-3 transition-[justify-content] duration-300",
              isSidebarCollapsed ? "justify-center" : "justify-end",
            )}
          >
            <Button
              isIconOnly
              aria-label={
                isSidebarCollapsed
                  ? "Expand docs sidebar"
                  : "Collapse docs sidebar"
              }
              className="docs-sidebar-toggle shrink-0"
              size="sm"
              variant="tertiary"
              onPress={() => setIsSidebarCollapsed((value) => !value)}
            >
              <SidebarToggleIcon />
            </Button>
          </div>

          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {doc.navItems.map((item, index) => (
              <SmoothLink
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
              </SmoothLink>
            ))}
          </nav>
        </div>
      </aside>

      <article className="docs-content min-w-0 px-6 py-8 lg:px-10 lg:py-10">
        <header className="flex gap-4 border-b border-separator pb-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-medium leading-tight md:text-4xl">
              {doc.title}
            </h1>
            {doc.description && (
              <p className="mt-3 max-w-2xl text-muted leading-8">
                {doc.description}
              </p>
            )}
          </div>
          <div className="shrink-0">
            <DocsEditEntry />
          </div>
        </header>
        <div
          dangerouslySetInnerHTML={{ __html: doc.contentHtml }}
          className="docs-markdown mt-8 max-w-3xl"
        />
      </article>
    </section>
  );
}
