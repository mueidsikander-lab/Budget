// Cache name is bumped whenever the shell file list changes so the old cache
// (which cached every GET, including API responses) is dropped on activate.
var CACHE_NAME = "budget-shell-v3-earth";
var SHELL_FILES = ["./", "./index.html", "./budget-core.js", "./setup.html", "./manifest.json", "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png"];

// Only these same-origin paths are ever written to the cache. The previous
// version cached the response to every GET the page made, which meant Gist
// comment bodies — the user's bank alerts — sat in the cache indefinitely, and
// the cache-busting `?t=<timestamp>` on each sync created a new entry every
// time it ran, so the cache grew without bound and was never read back.
var SHELL_PATHS = ["/", "/index.html", "/budget-core.js", "/setup.html", "/manifest.json"];

function isShellRequest(req) {
  var url;
  try { url = new URL(req.url); } catch (e) { return false; }
  if (url.origin !== self.location.origin) return false;
  if (url.search) return false;
  var base = new URL("./", self.location).pathname;
  var path = url.pathname.slice(base.length - 1); // keep the leading slash
  return SHELL_PATHS.indexOf(path) > -1 || /^\/icons\/[\w.-]+$/.test(path);
}

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL_FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Network-first so the user always gets the latest app code when online;
// falls back to the cached shell only when the request fails (offline).
// Anything that is not part of the app shell — api.github.com, the CDN scripts —
// goes straight to the network and is never stored.
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  if (!isShellRequest(e.request)) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.ok && res.type === "basic") {
        var resClone = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, resClone); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) { return hit || caches.match("./index.html"); });
    })
  );
});
