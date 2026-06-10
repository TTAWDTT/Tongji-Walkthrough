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
          href="https://github.com/TTAWDTT"
          rel="noopener noreferrer"
          target="_blank"
          title="TTAWDTT on GitHub"
        >
          <span className="text-muted">Developed by</span>
          <p className="text-accent">TTAWDTT</p>
        </a>
      </footer>
    </div>
  );
}
