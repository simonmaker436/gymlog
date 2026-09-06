/* Service worker: guarda la app en caché para que funcione sin conexión.

   Al desplegar una versión nueva hay que subir DOS cosas a la vez:
     1. VERSION acá abajo
     2. el ?v= de los <script>/<link> en index.html
   Si solo se sube una, el navegador puede quedarse con la mezcla vieja. */
var VERSION = '7';
var CACHE = 'gymlog-v' + VERSION;

var ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css?v=' + VERSION,
  './js/stats.js?v=' + VERSION,
  './js/achievements.js?v=' + VERSION,
  './js/demo.js?v=' + VERSION,
  './js/store.js?v=' + VERSION,
  './js/charts.js?v=' + VERSION,
  './js/ui.js?v=' + VERSION,
  './js/views.js?v=' + VERSION,
  './js/app.js?v=' + VERSION,
  './js/cloud.js?v=' + VERSION,
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

/* `cache: 'no-store'` en todas las descargas del service worker: sin esto, el
   fetch() de aquí adentro puede recibir la copia vieja de la caché HTTP del
   navegador (o de un CDN intermedio) y el service worker guardaría esa copia
   vieja creyendo que acaba de bajar la nueva. Era exactamente el agujero por el
   que se colaba la versión anterior. */
function fromNetwork(req) {
  return fetch(req, { cache: 'no-store' });
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        return Promise.all(ASSETS.map(function (url) {
          return fetch(url, { cache: 'no-store' }).then(function (res) {
            if (res && res.ok) return c.put(url, res);
          })['catch'](function () { /* un archivo suelto no tumba la instalación */ });
        }));
      })
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
      fromNetwork(req)['catch'](function () {
        return caches.match('./index.html').then(function (r) { return r || caches.match('./'); });
      })
    );
    return;
  }

  var url = new URL(req.url);
  var sameOrigin = url.origin === location.origin;
  var isCode = sameOrigin && /\.(?:js|css)$/.test(url.pathname);

  /* El código de la app va a la red primero: si hay internet siempre se ve la
     versión recién desplegada, y si no la hay se usa la copia guardada. Antes
     era al revés, y por eso un deploy correcto podía seguir mostrando la
     versión vieja durante días. */
  if (isCode) {
    e.respondWith(
      fromNetwork(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })['catch'](function () {
        /* ignoreSearch: sin conexión, una copia de otra versión es mejor que
           una pantalla en blanco. */
        return caches.match(req).then(function (r) {
          return r || caches.match(req, { ignoreSearch: true });
        });
      })
    );
    return;
  }

  // el resto (iconos, manifiesto): caché primero, y refresca en segundo plano
  e.respondWith(
    caches.match(req).then(function (cached) {
      var net = fromNetwork(req).then(function (res) {
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
