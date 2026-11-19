// SmokySignal service worker. Two jobs:
//   1. Web Push (the handlers at the bottom of this file).
//   2. A minimal offline shell: the /offline page, hashed CSS/JS chunks and
//      icons. HTML is network-first; if the network is gone the rider gets
//      /offline ("No signal"), never a stale page.
//
// What this worker must never do:
//   - cache API JSON (/api/*) or anything status-shaped: a cached status
//     served as live is worse than no status;
//   - cache HTML (only the pre-cached /offline page is ever stored);
//   - answer non-GET or cross-origin requests.
//
// Bump CACHE_VERSION to retire the shell cache; activate deletes every
// older ss-shell-* cache. Keep this file small so installed PWAs update fast.

const CACHE_VERSION = "v1";
const CACHE_PREFIX = "ss-shell-";
const SHELL_CACHE = CACHE_PREFIX + CACHE_VERSION;
const OFFLINE_URL = "/offline";
const SHELL_ICONS = [
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/favicon.svg",
  "/icons/favicon-32.png",
  "/icons/apple-touch-icon.png",
];
// Hashed build output grows with every deploy; keep the newest entries.
const MAX_RUNTIME_ENTRIES = 120;

// Pull the hashed chunk URLs (CSS, JS, fonts) out of the /offline HTML so
// the page renders styled with no network on first use.
function extractStaticUrls(html) {
  const found = new Set();
  const re = /["'(](\/_next\/static\/[^"'()\s\\]+)/g;
  let m;
  while ((m = re.exec(html))) found.add(m[1]);
  return Array.from(found);
}

// Production build output is served "immutable" (content-hashed names).
// Dev chunks are not, and must never be pinned in a cache.
function isImmutable(res) {
  return /\bimmutable\b/i.test(res.headers.get("cache-control") || "");
}

async function addStatic(cache, url) {
  try {
    const res = await fetch(url);
    if (res.ok && res.type === "basic" && isImmutable(res)) await cache.put(url, res);
  } catch (_) {
    // best-effort
  }
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  const res = await fetch(OFFLINE_URL, { cache: "reload", credentials: "same-origin" });
  let chunks = [];
  if (res.ok && !res.redirected) {
    const html = await res.clone().text();
    await cache.put(OFFLINE_URL, res);
    chunks = extractStaticUrls(html);
  }
  await Promise.all([
    ...SHELL_ICONS.map((u) => cache.add(u).catch(() => {})),
    ...chunks.map((u) => addStatic(cache, u)),
  ]);
}

self.addEventListener("install", (event) => {
  // A failed precache (offline install) must not block the worker: push
  // still has to work, and the shell fills in on the next activation.
  event.waitUntil(precacheShell().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Paths this worker leaves strictly alone. Anything here goes straight to
// the network with no respondWith, so no cache can ever answer it.
function neverCache(url) {
  const p = url.pathname;
  return (
    p.startsWith("/api/") ||
    p.startsWith("/_vercel/") ||
    p === "/sw.js" ||
    p.endsWith(".json") ||
    p.endsWith(".ics") ||
    p.endsWith(".txt")
  );
}

function isShellAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

function offlineFallback() {
  return caches.open(SHELL_CACHE).then((cache) =>
    cache.match(OFFLINE_URL).then(
      (hit) =>
        hit ||
        new Response(
          "<!doctype html><meta charset=utf-8>" +
            '<meta name=viewport content="width=device-width,initial-scale=1"><title>No signal</title>' +
            '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0D10;color:#F2F4F7;font:16px system-ui;text-align:center;padding:24px">' +
            "<p>No signal. Last update unknown. SmokySignal needs a connection to see the sky.</p>",
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
        ),
    ),
  );
}

async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - (MAX_RUNTIME_ENTRIES + SHELL_ICONS.length + 1);
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic" && isImmutable(res)) {
    await cache.put(request, res.clone());
    await trim(cache);
  }
  return res;
}

// Icons are not content-hashed: serve the cached copy, refresh behind it.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok && res.type === "basic") cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await refresh) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (neverCache(url)) return;

  // HTML: network-first, nothing stored. Offline falls back to /offline.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => offlineFallback()));
    return;
  }

  if (isShellAsset(url)) {
    event.respondWith(
      url.pathname.startsWith("/icons/")
        ? staleWhileRevalidate(request)
        : cacheFirst(request),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = {};
  }
  const title = payload.title || "Smokey";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/favicon-96.png",
    tag: payload.tag || "smokey",
    renotify: false,
    data: payload.data || {},
    silent: payload.silent === true,
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // Voice readback bridge — broadcast title/body to any open client
      // so it can call speechSynthesis. SW itself can't speak. No-op
      // when no tab is open; the page-side listener gates on the
      // ss_voice_mode localStorage key.
      clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((wins) => {
          for (const w of wins) {
            try {
              w.postMessage({
                kind: "ss-voice-readback",
                title,
                body: options.body,
              });
            } catch (_) {
              // best-effort
            }
          }
        }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((wins) => {
      const existing = wins.find((c) => c.url.endsWith(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    }),
  );
});
