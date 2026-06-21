var CACHE_NAME = "budget-shell-v1";
var SHELL_FILES = ["./", "./index.html", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL_FILES); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
  }));
});

// Network-first so the user always gets the latest app code when online;
// falls back to the cached shell only when the request fails (offline).
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      var resClone = res.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(e.request, resClone); });
      return res;
    }).catch(function () { return caches.match(e.request); })
  );
});
