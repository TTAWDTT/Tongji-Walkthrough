export type SiteConfig = typeof siteConfig;

export const siteConfig = {
  name: "Tongji Walkthrough",
  description: "A concise walkthrough for Tongji University life and study.",
  navItems: [
    {
      label: "Home",
      href: "/",
    },
    {
      label: "Docs",
      href: "/docs",
    },
    {
      label: "About",
      href: "/about",
    },
  ],
  navMenuItems: [
    {
      label: "Home",
      href: "/",
    },
    {
      label: "Docs",
      href: "/docs",
    },
    {
      label: "About",
      href: "/about",
    },
  ],
  links: {
    github: "https://github.com/TTAWDTT/Tongji-Walkthrough",
    docs: "/docs",
  },
};
