/** @type {import('next').NextConfig} */
const repoName = "Tongji-Walkthrough";
const isGithubPages = process.env.GITHUB_PAGES === "true";
const hasCustomDomain = process.env.GITHUB_PAGES_CUSTOM_DOMAIN === "true";
const basePath = isGithubPages && !hasCustomDomain ? `/${repoName}` : "";

const nextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
