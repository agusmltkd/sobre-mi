// Service worker de "Sobre mí".
// Estrategia: la carcasa de la app se sirve desde caché para que
// abra al instante y funcione sin cobertura; los datos de vuelo
// nunca se cachean, porque un avión de hace veinte minutos es
// peor que no tener dato.

const CACHE = "sobre-mi-v3";

const CARCASA = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icono.svg"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CARCASA))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(
        claves.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Todo lo que sea API va directo a red, sin pasar por caché.
  if (url.hostname.includes("opensky-network.org") ||
      url.hostname.includes("adsbdb.com")) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(guardado => guardado || fetch(e.request))
  );
});
