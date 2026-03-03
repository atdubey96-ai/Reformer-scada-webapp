const CACHE_NAME = "scada-burner-v19";
const OFFLINE_URL = "./index.html";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.svg",
  "./icon-512.svg"
];

async function cacheCoreAssets() {
  const cache = await caches.open(CACHE_NAME);
  const reqs = CORE_ASSETS.map((url) =>
    new Request(url, { cache: url.indexOf("index.html") >= 0 ? "reload" : "default" })
  );
  await cache.addAll(reqs);
}

async function cleanupOldCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  );
}

function isHtmlRequest(request) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return accept.indexOf("text/html") >= 0;
}

function shouldPersistInCache(request) {
  try {
    const url = new URL(request.url);
    const path = url.pathname || "";
    return (
      path === "/" ||
      path.endsWith("/index.html") ||
      path.endsWith("/manifest.webmanifest") ||
      path.endsWith("/icon-192.svg") ||
      path.endsWith("/icon-512.svg")
    );
  } catch (_) {
    return false;
  }
}

async function networkFresh(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request, { cache: "no-store" });
    if (networkResponse && networkResponse.ok && shouldPersistInCache(request)) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (isHtmlRequest(request)) {
      const offline = await cache.match(OFFLINE_URL, { ignoreSearch: true });
      if (offline) return offline;
    }
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheCoreAssets());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanupOldCaches());
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event && event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(networkFresh(event.request));
});
