// Site identity for SEO surfaces: canonical origin, the shared page
// metadata helper, and the static route list the sitemap and the audit
// script both read.
//
// The canonical origin is the www host. The apex (smokysignal.app)
// redirects there, so every canonical, sitemap URL and JSON-LD @id uses
// it regardless of which deployment rendered the page. Preview deploys
// keep pointing canonicals at production on purpose: previews are not
// meant to be indexed.
//
// Copy rules (design/BRAND.md §3): titles and descriptions stay laconic,
// no emoji, no exclamation marks, none of the voice-gate words.

import type { Metadata } from "next";

export const SITE_URL = "https://www.smokysignal.app";
export const SITE_NAME = "SmokySignal";
export const GITHUB_URL = "https://github.com/adavenport-ops/SmokySignal";
export const LOGO_PATH = "/icons/icon-512.png";
export const DEFAULT_OG_IMAGE = "/icons/og-image.png";

/** Absolute URL on the canonical origin. */
export function absUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The feed links the root layout advertises; repeated so a page that
 * sets its own `alternates` keeps them (Next replaces the whole object). */
const FEED_TYPES = {
  "application/atom+xml": [{ url: "/feed.xml", title: "SmokySignal takeoffs (Atom)" }],
  "application/rss+xml": [{ url: "/rss.xml", title: "SmokySignal takeoffs (RSS)" }],
};

export type PageMetaInput = {
  /** Page title without the " · SmokySignal" suffix (the root template adds it). */
  title: string;
  description: string;
  /** Canonical path, e.g. "/plane/N305DK". No query string. */
  path: string;
  /** Social title; defaults to `${title} · SmokySignal`. */
  socialTitle?: string;
  socialDescription?: string;
  /** Explicit share image. Default: the static brand card. */
  image?: { url: string; width?: number; height?: number; alt: string };
  /**
   * Leave og:image to this segment's own opengraph-image file (home, road,
   * wrap, flight). A page that sets openGraph without images otherwise
   * loses the cascaded parent file image, so everything else gets the
   * brand card explicitly.
   */
  inheritImage?: boolean;
  /** Mark the page noindex (still followable). */
  noindex?: boolean;
  /** Use the title as-is, no template suffix. */
  absoluteTitle?: boolean;
  ogType?: "website" | "article";
};

/**
 * One call per page: title, description, canonical, Open Graph and
 * Twitter card that all agree. Without this every page inherited the
 * root layout's og:title, so every share card read the same.
 */
export function pageMeta(input: PageMetaInput): Metadata {
  const social = input.socialTitle ?? (input.absoluteTitle ? input.title : `${input.title} · ${SITE_NAME}`);
  const socialDescription = input.socialDescription ?? input.description;
  const images = input.image
    ? [input.image]
    : input.inheritImage
      ? undefined
      : [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: SITE_NAME }];
  return {
    title: input.absoluteTitle ? { absolute: input.title } : input.title,
    description: input.description,
    alternates: { canonical: input.path, types: FEED_TYPES },
    openGraph: {
      title: social,
      description: socialDescription,
      url: input.path,
      siteName: SITE_NAME,
      type: input.ogType ?? "website",
      locale: "en_US",
      ...(images ? { images } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: social,
      description: socialDescription,
      ...(images ? { images: images.map((i) => i.url) } : {}),
    },
    ...(input.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

/** True when any of the named query params is present and non-empty. */
export function hasParam(
  sp: Record<string, string | string[] | undefined> | undefined,
  names: readonly string[],
): boolean {
  if (!sp) return false;
  return names.some((n) => {
    const v = sp[n];
    return Array.isArray(v) ? v.length > 0 : typeof v === "string";
  });
}

export type StaticRoute = {
  path: string;
  changeFrequency: "always" | "hourly" | "daily" | "weekly" | "monthly";
  priority: number;
};

/**
 * Indexable static pages, in sitemap order. Settings, admin, embed,
 * glance, relay/manage and offline are deliberately absent.
 */
export const STATIC_ROUTES: readonly StaticRoute[] = [
  { path: "/", changeFrequency: "always", priority: 1 },
  { path: "/radar", changeFrequency: "always", priority: 0.9 },
  { path: "/flights", changeFrequency: "always", priority: 0.8 },
  { path: "/circling", changeFrequency: "always", priority: 0.9 },
  { path: "/seen", changeFrequency: "daily", priority: 0.8 },
  { path: "/program", changeFrequency: "weekly", priority: 0.9 },
  { path: "/aircraft", changeFrequency: "weekly", priority: 0.8 },
  { path: "/road", changeFrequency: "daily", priority: 0.7 },
  { path: "/forecast", changeFrequency: "daily", priority: 0.7 },
  { path: "/stats", changeFrequency: "daily", priority: 0.6 },
  { path: "/data", changeFrequency: "daily", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/help", changeFrequency: "monthly", priority: 0.6 },
  { path: "/relay", changeFrequency: "monthly", priority: 0.4 },
  { path: "/embed/help", changeFrequency: "monthly", priority: 0.4 },
  { path: "/board", changeFrequency: "always", priority: 0.3 },
  { path: "/legal", changeFrequency: "monthly", priority: 0.3 },
];

/** Paths robots.txt keeps crawlers out of. */
export const ROBOTS_DISALLOW: readonly string[] = [
  "/admin",
  "/api/admin",
  "/relay/manage",
  "/embed",
  "/qa-dashboard",
];

/** AI crawlers the owner explicitly welcomes. */
export const AI_CRAWLERS: readonly string[] = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "CCBot",
  "Applebot-Extended",
];

/** Root meta keywords: the phrases people actually search with. */
export const SITE_KEYWORDS: readonly string[] = [
  "Washington State Patrol aircraft",
  "WSP plane tracker",
  "state patrol plane",
  "Smokey plane",
  "aerial speed enforcement Washington",
  "police aircraft tracker",
  "police plane I-5",
  "King County Sheriff Guardian One",
  "plane circling Tacoma",
  "ADS-B",
  "Puget Sound",
];

export const HOME_TITLE = "SmokySignal · Live Washington State Patrol aircraft tracker";
export const HOME_DESCRIPTION =
  "Is the state patrol plane flying today? Live map of WSP, King County Guardian One and county sheriff aircraft over Puget Sound and Washington, from public ADS-B.";
