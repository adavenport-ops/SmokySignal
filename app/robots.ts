// /robots.txt: everything public is open, admin and the framable widget
// are not, and the major AI crawlers are welcomed by name (the owner wants
// SmokySignal readable and citable by answer engines). /embed/help is the
// widget's how-to page and stays crawlable; the longer Allow wins.

import type { MetadataRoute } from "next";
import { AI_CRAWLERS, ROBOTS_DISALLOW, SITE_URL } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  const rule = { allow: ["/", "/embed/help"], disallow: [...ROBOTS_DISALLOW] };
  return {
    rules: [
      { userAgent: "*", ...rule },
      { userAgent: [...AI_CRAWLERS], ...rule },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
