/* Service worker: guarda la app en caché para que funcione sin conexión. */
var CACHE = 'gymlog-v3';
var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/pre.js',
  './js/stats.js',
  './js/achievements.js',
  './js/demo.js',
  './js/store.js',
  './js/charts.js',
  './js/ui.js',
  './js/views.js',
  './js/app.js',
  './js/cloud.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches['delete'](k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  // navegación: intenta red, cae a la copia guardada
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)['catch'](function () {
        return caches.match('./index.html').then(function (r) { return r || caches.match('./'); });
      })
    );
    return;
  }

  // resto: caché primero, y refresca en segundo plano
  e.respondWith(
    caches.match(req).then(function (cached) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })['catch'](function () { return cached; });
      return cached || net;
    })
  );
});
