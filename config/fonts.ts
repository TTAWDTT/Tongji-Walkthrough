import localFont from "next/font/local";

export const fontSans = localFont({
  src: [
    {
      path: "../public/fonts/LXGWWenKai-Regular.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-lxgw-sans",
  display: "swap",
});

export const fontMono = localFont({
  src: [
    {
      path: "../public/fonts/LXGWWenKaiMono-Regular.ttf",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-lxgw-mono",
  display: "swap",
});
