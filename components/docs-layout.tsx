import type { DocPageData } from "@/lib/docs";

import NextLink from "next/link";
import clsx from "clsx";

export function DocsLayout({ doc }: { doc: DocPageData }) {
  return (
    <section className="grid gap-8 py-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:py-10">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="border-b border-separator pb-3 text-sm font-medium text-muted lg:border-b-0">
          Docs
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {doc.navItems.map((item) => (
            <NextLink
              key={item.slug}
              className={clsx(
                "shrink-0 rounded-md px-3 py-2 text-sm no-underline transition-colors",
                item.slug === doc.slug
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:bg-surface hover:text-foreground",
              )}
              href={item.href}
            >
              {item.title}
            </NextLink>
          ))}
        </nav>
      </aside>

      <article className="min-w-0">
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
