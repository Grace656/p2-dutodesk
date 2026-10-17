const CACHE = "dutodesk-shell-v18";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/data.js",
  "/supabase-config.js",
  "/badge.jpg",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(
    fetch(event.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return res;
    }).catch(() => caches.match(event.request).then((hit) => hit || caches.match("/index.html")))
  );
});

// ---- message alerts ----
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // the app is open in front: the chat already shows the message
      if (list.some((c) => c.visibilityState === "visible" && c.focused)) return;
      return self.registration.showNotification(data.title || "Duty Desk", {
        body: data.body || "New message",
        icon: "/badge.jpg",
        badge: "/badge.jpg",
        tag: data.tag || "duty-desk",
        renotify: true,
        data: { url: data.url || "/#/log" }
      });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/#/log", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          return c.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : undefined));
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
