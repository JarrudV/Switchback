const SW_VERSION = "v3";
const SHELL_CACHE = `peakready-shell-${SW_VERSION}`;
const API_CACHE = `peakready-api-${SW_VERSION}`;

const SHELL_ASSETS = [
  "/index.html",
  "/manifest.json",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-192-maskable.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
];
const OFFLINE_API_PATHS = new Set(["/api/sessions", "/api/metrics"]);
const API_CACHE_ALLOWLIST = [
  "/api/sessions",
  "/api/metrics",
  "/api/service-items",
  "/api/goal",
  "/api/settings/",
  "/api/strava/status",
  "/api/strava/activities",
  "/api/coach/context",
  "/api/insights/latest-ride",
  "/api/plan/templates",
];
const API_BYPASS_PREFIXES = ["/api/auth/", "/api/logout", "/api/strava/auth-url", "/api/strava/callback"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("peakready-") && name !== SHELL_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_USER_CACHE") {
    event.waitUntil(clearUserApiCache().then(() => notifyClients({ type: "CACHE_CLEARED" })));
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (!isSameOrigin) {
    return;
  }

  const path = url.pathname;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (path === "/api/logout") {
    event.respondWith(
      clearUserApiCache().then(() => fetch(request)).catch(() => fetch(request)),
    );
    return;
  }

  if (path.startsWith("/api/")) {
    if (shouldBypassApiCache(path)) {
      return;
    }
    if (shouldCacheApi(path)) {
      event.respondWith(staleWhileRevalidate(request, path));
    }
    return;
  }

  const isAssetRequest =
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "image" ||
    request.destination === "font";

  if (isAssetRequest) {
    event.respondWith(cacheFirstShell(request));
  }
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const network = await fetch(request);
    if (network && network.ok) {
      await cache.put("/index.html", network.clone());
    }
    return network;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match("/index.html"));
    if (cached) {
      return cached;
    }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

self.addEventListener("push", (event) => {
  const data = event.data?.json?.() ?? {};
  const title = data.title || "PeakReady";
  const body = data.body || "You have a new reminder.";
  const url = data.url || "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url },
      tag: data.tag || undefined,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

async function cacheFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const network = await fetch(request);
  if (network && network.ok) {
    cache.put(request, network.clone());
  }
  return network;
}

async function staleWhileRevalidate(request, path) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (network) => {
      if (network && network.ok) {
        await cache.put(request, network.clone());
        await notifyClients({
          type: "SYNC_UPDATE",
          timestamp: new Date().toISOString(),
          path,
        });
      }
      return network;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => null);
    return cached;
  }

  const network = await networkPromise;
  if (network) {
    return network;
  }

  if (OFFLINE_API_PATHS.has(path)) {
    const fallback = await cache.match(request);
    if (fallback) {
      return fallback;
    }
  }

  return new Response(JSON.stringify({ error: "Offline and no cached data available" }), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function shouldBypassApiCache(path) {
  return API_BYPASS_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function shouldCacheApi(path) {
  return API_CACHE_ALLOWLIST.some((allowPath) => path === allowPath || path.startsWith(allowPath));
}

async function clearUserApiCache() {
  const cache = await caches.open(API_CACHE);
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((request) => new URL(request.url).pathname.startsWith("/api/"))
      .map((request) => cache.delete(request)),
  );
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  await Promise.all(clients.map((client) => client.postMessage(message)));
}
