import clsx from "clsx";

import { Head } from "./head";

import { Navbar } from "@/components/navbar";

export default function DefaultLayout({
  children,
  fullBleed = false,
}: {
  children: React.ReactNode;
  fullBleed?: boolean;
}) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <Head />
      <Navbar />
      <main
        className={clsx(
          "flex-grow",
          fullBleed ? "w-full" : "container mx-auto max-w-7xl px-6 pt-16",
        )}
      >
        {children}
      </main>
      <footer
        className={clsx(
          "w-full items-center justify-center py-3",
          fullBleed ? "hidden" : "flex",
        )}
      >
        <a
          className="flex items-center gap-1 text-current no-underline"
          href="https://www.heroui.com"
          rel="noopener noreferrer"
          target="_blank"
          title="heroui.com homepage"
        >
          <span className="text-muted">Powered by</span>
          <p className="text-accent">HeroUI</p>
        </a>
      </footer>
    </div>
  );
}
