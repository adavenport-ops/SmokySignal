// Structured data for crawlers and answer engines. Renders one
// type="application/ld+json" script: a data block, never executed, so
// the CSP's script-src does not apply to it. Builders and the escaping
// serializer live in lib/seo/jsonld.ts; this only renders.

import { serializeJsonLd, type JsonLdObject } from "@/lib/seo/jsonld";

export function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  return (
    <script
      type="application/ld+json"
      // Server-built from registry data; serializeJsonLd escapes < > &.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
