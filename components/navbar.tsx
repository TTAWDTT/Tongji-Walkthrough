import { useState } from "react";
import { Link, Tooltip } from "@heroui/react";
import clsx from "clsx";

import { siteConfig } from "@/config/site";
import { ThemeSwitch } from "@/components/theme-switch";
import { GithubIcon, WechatIcon } from "@/components/icons";
import { SmoothLink } from "@/components/smooth-link";

export function WechatGroupTooltip({ basePath }: { basePath: string }) {
  return (
    <Tooltip.Root closeDelay={120} delay={120}>
      <Tooltip.Trigger
        aria-label="Show WeChat group QR code"
        className="icon-link"
      >
        <WechatIcon className="text-[#07C160]" />
      </Tooltip.Trigger>
      <Tooltip.Content
        showArrow
        className="wechat-tooltip-content"
        offset={10}
        placement="bottom end"
      >
        <img
          alt="Tongji Walkthrough WeChat group QR code"
          className="h-auto w-64 rounded-md"
          height={973}
          src={`${basePath}/brand/wechat-group.jpg`}
          width={717}
        />
      </Tooltip.Content>
    </Tooltip.Root>
  );
}

export function NavbarBrand({ basePath }: { basePath: string }) {
  return (
    <SmoothLink className="brand-link inline-flex items-center gap-1" href="/">
      <img
        alt=""
        className="h-9 w-9 object-contain"
        height={36}
        src={`${basePath}/brand/site-logo.png`}
        width={36}
      />
      <p className="font-bold text-inherit">Tongji Walkthrough</p>
    </SmoothLink>
  );
}

export function NavbarActions({
  basePath,
  className,
}: {
  basePath: string;
  className?: string;
}) {
  return (
    <div className={clsx("items-center gap-1", className)}>
      <WechatGroupTooltip basePath={basePath} />
      <Link
        aria-label="Github"
        className="icon-link"
        href={siteConfig.links.github}
        rel="noopener noreferrer"
        target="_blank"
      >
        <GithubIcon className="text-muted" />
      </Link>
      <ThemeSwitch className="icon-link" />
    </div>
  );
}

export const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-separator bg-background/95 shadow-[0_1px_0_color-mix(in_oklch,var(--foreground)_5%,transparent)] backdrop-blur-lg">
      <header className="flex h-16 w-full items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <NavbarBrand basePath={basePath} />
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

        <NavbarActions basePath={basePath} className="hidden sm:flex" />

        <div className="flex sm:hidden items-center gap-1">
          <NavbarActions basePath={basePath} className="flex" />
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
