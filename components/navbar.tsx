import { useState } from "react";
import { Link } from "@heroui/react";
import clsx from "clsx";

import { siteConfig } from "@/config/site";
import { ThemeSwitch } from "@/components/theme-switch";
import { GithubIcon, Logo } from "@/components/icons";
import { SmoothLink } from "@/components/smooth-link";

export const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-separator bg-background/95 shadow-[0_1px_0_color-mix(in_oklch,var(--foreground)_5%,transparent)] backdrop-blur-lg">
      <header className="flex h-16 w-full items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <SmoothLink className="brand-link flex items-center gap-1" href="/">
            <Logo />
            <p className="font-bold text-inherit">Tongji Walkthrough</p>
          </SmoothLink>
          <ul className="hidden lg:flex gap-4 ml-2">
            {siteConfig.navItems.map((item) => (
              <li key={item.href}>
                <SmoothLink
                  className={clsx(
                    "nav-link text-foreground",
                    "data-[active=true]:text-accent data-[active=true]:font-medium",
                  )}
                  href={item.href}
                >
                  {item.label}
                </SmoothLink>
              </li>
            ))}
          </ul>
        </div>

        <div className="hidden sm:flex items-center gap-2">
          <Link
            aria-label="Github"
            className="icon-link"
            href={siteConfig.links.github}
            rel="noopener noreferrer"
            target="_blank"
          >
            <GithubIcon className="text-muted" />
          </Link>
          <ThemeSwitch />
        </div>

        <div className="flex sm:hidden items-center gap-2">
          <Link
            aria-label="Github"
            className="icon-link"
            href={siteConfig.links.github}
            rel="noopener noreferrer"
            target="_blank"
          >
            <GithubIcon className="text-muted" />
          </Link>
          <ThemeSwitch />
          <button
            aria-expanded={isMenuOpen}
            aria-label="Toggle menu"
            className="p-2"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {isMenuOpen ? (
                <path
                  d="M6 18L18 6M6 6l12 12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                />
              ) : (
                <path
                  d="M4 6h16M4 12h16M4 18h16"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                />
              )}
            </svg>
          </button>
        </div>
      </header>

      {isMenuOpen && (
        <div className="border-t border-separator sm:hidden">
          <ul className="flex flex-col gap-2 px-4 py-4">
            {siteConfig.navMenuItems.map((item) => (
              <li key={item.href}>
                <SmoothLink
                  className={clsx(
                    "nav-link block py-2 text-lg text-foreground",
                  )}
                  href={item.href}
                  onClick={() => setIsMenuOpen(false)}
                >
                  {item.label}
                </SmoothLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
};
