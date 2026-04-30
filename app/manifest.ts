import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // id/scope/start_url all root-relative so iOS treats the PWA install
    // as the same app whether reached via the custom domain or any Vercel
    // deploy URL.
    id: "/",
    name: "SmokySignal",
    short_name: "SmokySignal",
    description:
      "Real-time WSP aircraft tracker for Puget Sound riders",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b0d10",
    theme_color: "#0b0d10",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
