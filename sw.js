// Service worker de "Sobre mí".
//
// Estrategia: RED PRIMERO para el documento, caché primero para lo
// que no cambia (iconos, manifiesto).
//
// La versión anterior hacía caché primero para todo, y eso tiene un
// efecto perverso: los cambios que publicas no llegan nunca, porque
// el navegador sigue sirviendo la copia guardada. Un fallo de red es
// molesto de vez en cuando; servir código viejo lo es siempre.

const CACHE = "sobre-mi-v10";

const CARCASA = [
  "./",
  "./index.html",
  "./historia.html",
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

  // Las APIs van directas a la red, sin pasar por caché: un avión
  // de hace veinte minutos es peor que no tener dato.
  if (url.hostname.includes("workers.dev") ||
      url.hostname.includes("adsbdb.com") ||
      url.hostname.includes("airplanes.live") ||
      url.hostname.includes("adsb.lol") ||
      url.hostname.includes("adsb.fi") ||
      url.hostname.includes("opensky-network.org")) {
    return;
  }

  const esDocumento = e.request.mode === "navigate" ||
                      url.pathname.endsWith(".html") ||
                      url.pathname.endsWith("/");

  if (esDocumento) {
    // Red primero: si hay conexión ves siempre la última versión, y
    // la copia guardada solo entra en juego cuando no la hay.
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copia));
          return res;
        })
        .catch(() => caches.match(e.request).then(g => g || caches.match("./index.html")))
    );
    return;
  }

  // El resto (iconos, manifiesto) no cambia: caché primero.
  e.respondWith(
    caches.match(e.request).then(guardado => guardado || fetch(e.request))
  );
});
