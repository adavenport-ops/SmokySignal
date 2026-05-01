// SmokySignal service worker. Web Push only — caching is out of scope here
// (we lean on Vercel's edge cache for static assets). Keep this file tiny so
// installed PWAs update fast.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
  event.waitUntil(self.registration.showNotification(title, options));
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
