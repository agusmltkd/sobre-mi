// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: plane;

// ============================================================
//  SOBRE MÍ · v2
//  Widget de Scriptable
//
//  Qué está pasando por encima ahora mismo: no dónde mirar,
//  sino qué es. Ruta, modelo, matrícula y compañía.
//
//  Posiciones: OpenSky Network
//  Identidad y rutas: adsbdb.com (gratis, sin clave)
// ============================================================


// ------------------------------------------------------------
//  1. CONFIGURACIÓN
// ------------------------------------------------------------

const CASA = {
  lat: 37.402935,
  lon: -5.957803,
  nombre: "Casa"
};

// Con 25 km cubres el área terminal de San Pablo entera y las
// aproximaciones completas por los dos cabeceros.
const RADIO_KM = 25;

const CLIENT_ID     = "agusmorla-api-client";
const CLIENT_SECRET = "TnzprX1v6UDGqjnt8fmmqe5i9gYCRmJ3";


// ------------------------------------------------------------
//  2. PALETA
//  Tira de progreso de vuelo: papel tintado, tinta negra, sello
//  rojo óxido. Misma identidad que la app.
// ------------------------------------------------------------

const C = {
  papel:    new Color("#E8E2D2"),
  tinta:    new Color("#1C1B18"),
  tenue:    new Color("#6B675C"),
  regla:    new Color("#B4AE9C"),
  destaque: new Color("#8C3A1E")
};


// ------------------------------------------------------------
//  3. GEOMETRÍA
// ------------------------------------------------------------

const R_TIERRA = 6371000;
const grados   = rad => rad * 180 / Math.PI;
const radianes = deg => deg * Math.PI / 180;

function distanciaSuelo(lat1, lon1, lat2, lon2) {
  const dLat = radianes(lat2 - lat1);
  const dLon = radianes(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(radianes(lat1)) * Math.cos(radianes(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R_TIERRA * Math.asin(Math.sqrt(a));
}

function acimut(lat1, lon1, lat2, lon2) {
  const f1 = radianes(lat1), f2 = radianes(lat2);
  const dl = radianes(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) -
            Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (grados(Math.atan2(y, x)) + 360) % 360;
}

const RUMBOS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
const octante = az => Math.round(az / 45) % 8;


// ------------------------------------------------------------
//  4. FICHEROS
// ------------------------------------------------------------

const fm = FileManager.local();
const ruta = n => fm.joinPath(fm.documentsDirectory(), n);

const F_TOKEN  = ruta("opensky_token.json");
const F_ESTADO = ruta("sobremi_ultimo.json");
const F_FICHA  = ruta("sobremi_fichas.json");   // icao24 -> avión
const F_RUTA   = ruta("sobremi_rutas.json");    // callsign -> ruta

function leerJSON(f, pordefecto) {
  if (!fm.fileExists(f)) return pordefecto;
  try { return JSON.parse(fm.readString(f)); }
  catch (e) { return pordefecto; }
}

const guardarJSON = (f, o) => fm.writeString(f, JSON.stringify(o));


// ------------------------------------------------------------
//  5. OPENSKY
// ------------------------------------------------------------

const URL_TOKEN = "https://auth.opensky-network.org/auth/realms/" +
                  "opensky-network/protocol/openid-connect/token";

async function obtenerToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) return null;

  const guardado = leerJSON(F_TOKEN, null);
  if (guardado && guardado.expira > Date.now() + 60000) return guardado.token;

  const req = new Request(URL_TOKEN);
  req.method = "POST";
  req.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  req.body = "grant_type=client_credentials" +
             `&client_id=${encodeURIComponent(CLIENT_ID)}` +
             `&client_secret=${encodeURIComponent(CLIENT_SECRET)}`;

  const res = await req.loadJSON();
  if (!res.access_token) throw new Error("OpenSky no devolvió token");

  guardarJSON(F_TOKEN, {
    token: res.access_token,
    expira: Date.now() + ((res.expires_in || 1800) - 30) * 1000
  });

  return res.access_token;
}

async function pedirEstados() {
  const dLat = RADIO_KM / 111.32;
  const dLon = RADIO_KM / (111.32 * Math.cos(radianes(CASA.lat)));

  const url = "https://opensky-network.org/api/states/all" +
              `?lamin=${CASA.lat - dLat}&lomin=${CASA.lon - dLon}` +
              `&lamax=${CASA.lat + dLat}&lomax=${CASA.lon + dLon}`;

  const req = new Request(url);
  req.timeoutInterval = 15;

  const token = await obtenerToken();
  if (token) req.headers = { Authorization: `Bearer ${token}` };

  const res = await req.loadJSON();
  return res.states || [];
}


// ------------------------------------------------------------
//  6. IDENTIDAD (adsbdb)
//
//  El icao24 de un avión no cambia nunca, así que su ficha se
//  cachea para siempre. La ruta de un callsign es estable pero
//  no eterna (cambia con la temporada), así que caduca a 30 días.
// ------------------------------------------------------------

const fichas = leerJSON(F_FICHA, {});
const rutas  = leerJSON(F_RUTA, {});
const CADUCIDAD_RUTA = 30 * 24 * 3600 * 1000;

async function pedirJSON(url) {
  const req = new Request(url);
  req.timeoutInterval = 8;
  return await req.loadJSON();
}

async function ficha(icao24) {
  if (fichas[icao24] !== undefined) return fichas[icao24];
  try {
    const r = await pedirJSON(`https://api.adsbdb.com/v0/aircraft/${icao24}`);
    const a = r.response && r.response.aircraft;
    fichas[icao24] = a ? {
      tipo: a.type || "",
      icaoTipo: a.icao_type || "",
      matricula: a.registration || "",
      operador: a.registered_owner || ""
    } : null;
  } catch (e) {
    return null;   // fallo puntual: no lo cacheamos como "no existe"
  }
  return fichas[icao24];
}

async function rutaVuelo(callsign) {
  if (!callsign) return null;
  const guardado = rutas[callsign];
  if (guardado && Date.now() - guardado.t < CADUCIDAD_RUTA) return guardado.v;

  try {
    const r = await pedirJSON(`https://api.adsbdb.com/v0/callsign/${callsign}`);
    const f = r.response && r.response.flightroute;
    const v = f ? {
      origen:  (f.origin && (f.origin.iata_code || f.origin.icao_code)) || "",
      destino: (f.destination && (f.destination.iata_code || f.destination.icao_code)) || "",
      origenNombre:  (f.origin && f.origin.municipality) || "",
      destinoNombre: (f.destination && f.destination.municipality) || ""
    } : null;
    rutas[callsign] = { t: Date.now(), v };
    return v;
  } catch (e) {
    return null;
  }
}


// ------------------------------------------------------------
//  7. PROCESADO
// ------------------------------------------------------------

const IDX = {
  icao24: 0, callsign: 1, pais: 2,
  lon: 5, lat: 6, altBaro: 7, enSuelo: 8,
  velocidad: 9, rumbo: 10, velVertical: 11, altGeo: 13
};

function procesar(estados) {
  return estados
    .filter(s => s[IDX.lat] != null && s[IDX.lon] != null && !s[IDX.enSuelo])
    .map(s => {
      const alt = s[IDX.altGeo] ?? s[IDX.altBaro] ?? 0;
      const d = distanciaSuelo(CASA.lat, CASA.lon, s[IDX.lat], s[IDX.lon]);
      if (d > RADIO_KM * 1000) return null;

      return {
        icao24: s[IDX.icao24],
        callsign: (s[IDX.callsign] || "").trim(),
        distanciaKm: d / 1000,
        acimut: acimut(CASA.lat, CASA.lon, s[IDX.lat], s[IDX.lon]),
        pies: alt * 3.28084,
        rumbo: s[IDX.rumbo] || 0,
        subiendo: (s[IDX.velVertical] || 0) > 1.5,
        bajando:  (s[IDX.velVertical] || 0) < -1.5,
        nudos: (s[IDX.velocidad] || 0) * 1.94384
      };
    })
    .filter(Boolean)
    // Ya no ordenamos por elevación: importa quién está más cerca
    // de la vertical, no qué se vería mejor desde la ventana.
    .sort((a, b) => a.distanciaKm - b.distanciaKm);
}

// Solo enriquecemos los que se van a mostrar: cada consulta es una
// petición de red y el widget tiene un presupuesto de tiempo corto
// antes de que iOS lo mate.
async function enriquecer(aviones, cuantos) {
  const lote = aviones.slice(0, cuantos);
  await Promise.all(lote.map(async a => {
    const [f, r] = await Promise.all([ficha(a.icao24), rutaVuelo(a.callsign)]);
    a.ficha = f;
    a.ruta = r;
  }));
  guardarJSON(F_FICHA, fichas);
  guardarJSON(F_RUTA, rutas);
  return aviones;
}

function formatoAltitud(pies) {
  if (pies >= 10000) return "FL" + String(Math.round(pies / 100)).padStart(3, "0");
  return (Math.round(pies / 100) * 100).toLocaleString("es-ES") + " ft";
}

// Mejor la matrícula real que el hexadecimal del transpondedor,
// que no le dice nada a nadie.
function etiqueta(a) {
  if (a.callsign) return a.callsign;
  if (a.ficha && a.ficha.matricula) return a.ficha.matricula;
  return a.icao24.toUpperCase();
}

function textoRuta(a) {
  if (a.ruta && a.ruta.origen && a.ruta.destino) {
    return `${a.ruta.origen} → ${a.ruta.destino}`;
  }
  if (a.ficha && a.ficha.operador) return a.ficha.operador.toUpperCase();
  return "—";
}

function textoAvion(a) {
  if (!a.ficha) return "";
  const partes = [];
  if (a.ficha.icaoTipo) partes.push(a.ficha.icaoTipo);
  if (a.ficha.matricula) partes.push(a.ficha.matricula);
  return partes.join(" · ");
}


// ------------------------------------------------------------
//  8. WIDGET
// ------------------------------------------------------------

function crearWidget(aviones, hora, esCache, total) {
  const w = new ListWidget();
  w.backgroundColor = C.papel;
  w.setPadding(13, 14, 13, 14);
  w.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);

  const familia = config.widgetFamily || "medium";
  const cuantos = familia === "small" ? 1 : familia === "large" ? 6 : 3;

  // -- Cabecera
  const cab = w.addStack();
  cab.layoutHorizontally();
  cab.centerAlignContent();

  const titulo = cab.addText(
    familia === "small" ? "ENCIMA" : `ENCIMA · ${total} en ${RADIO_KM} km`
  );
  titulo.font = Font.semiboldMonospacedSystemFont(9);
  titulo.textColor = C.tenue;

  cab.addSpacer();

  const marca = cab.addText(esCache ? hora + " ·" : hora);
  marca.font = Font.regularMonospacedSystemFont(9);
  marca.textColor = esCache ? C.destaque : C.tenue;

  w.addSpacer(5);

  const regla = w.addStack();
  regla.backgroundColor = C.regla;
  regla.size = new Size(0, 1);
  regla.addSpacer();

  w.addSpacer(7);

  if (aviones.length === 0) {
    w.addSpacer();
    const vacio = w.addText("Nada en " + RADIO_KM + " km");
    vacio.font = Font.regularMonospacedSystemFont(12);
    vacio.textColor = C.tenue;
    w.addSpacer();
    return w;
  }

  // -- Tiras
  aviones.slice(0, cuantos).forEach((a, i) => {
    if (i > 0) w.addSpacer(8);

    const fila = w.addStack();
    fila.layoutHorizontally();
    fila.centerAlignContent();

    // Columna izquierda: distancia horizontal, que es la medida
    // real de "encima de mí".
    const dist = fila.addStack();
    dist.layoutVertically();

    const km = dist.addText(a.distanciaKm.toFixed(1));
    km.font = Font.boldMonospacedSystemFont(familia === "small" ? 26 : 19);
    km.textColor = C.tinta;

    const uni = dist.addText("km " + RUMBOS[octante(a.acimut)]);
    uni.font = Font.regularMonospacedSystemFont(8);
    uni.textColor = C.tenue;

    fila.addSpacer(11);

    const datos = fila.addStack();
    datos.layoutVertically();

    // Línea 1: la ruta, que es la historia del vuelo.
    const l1 = datos.addStack();
    l1.layoutHorizontally();
    l1.centerAlignContent();

    const r = l1.addText(textoRuta(a));
    r.font = Font.boldMonospacedSystemFont(13);
    r.textColor = C.destaque;

    l1.addSpacer(7);

    const cs = l1.addText(etiqueta(a));
    cs.font = Font.semiboldMonospacedSystemFont(11);
    cs.textColor = C.tinta;

    datos.addSpacer(2);

    // Línea 2: qué avión es exactamente.
    const modelo = textoAvion(a);
    if (modelo) {
      const l2 = datos.addText(modelo);
      l2.font = Font.regularMonospacedSystemFont(9);
      l2.textColor = C.tinta;
      datos.addSpacer(1);
    }

    // Línea 3: estado de vuelo.
    const tendencia = a.subiendo ? "↑" : a.bajando ? "↓" : "→";
    const l3 = datos.addText(
      formatoAltitud(a.pies) + " " + tendencia +
      "   " + Math.round(a.nudos) + " kt"
    );
    l3.font = Font.regularMonospacedSystemFont(9);
    l3.textColor = C.tenue;

    fila.addSpacer();
  });

  w.addSpacer();
  return w;
}


// ------------------------------------------------------------
//  9. EJECUCIÓN
// ------------------------------------------------------------

const df = new DateFormatter();
df.dateFormat = "HH:mm";

const familiaActual = config.widgetFamily || "medium";
const aMostrar = familiaActual === "small" ? 1 : familiaActual === "large" ? 6 : 3;

let aviones = [];
let hora = df.string(new Date());
let esCache = false;
let total = 0;

try {
  aviones = procesar(await pedirEstados());
  total = aviones.length;
  await enriquecer(aviones, aMostrar);
  guardarJSON(F_ESTADO, { aviones: aviones.slice(0, 6), hora, total });
} catch (e) {
  console.error(e);
  // Si el token está revocado o caducado mal, lo tiramos para que el
  // siguiente intento pida uno limpio en vez de fallar en bucle.
  if (fm.fileExists(F_TOKEN)) fm.remove(F_TOKEN);

  const guardado = leerJSON(F_ESTADO, null);
  if (guardado) {
    aviones = guardado.aviones;
    hora = guardado.hora;
    total = guardado.total;
    esCache = true;
  }
}

const widget = crearWidget(aviones, hora, esCache, total);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  console.log(`${total} aviones en ${RADIO_KM} km de ${CASA.nombre}\n`);
  for (const a of aviones.slice(0, 10)) {
    if (a.ficha === undefined) {
      a.ficha = await ficha(a.icao24);
      a.ruta  = await rutaVuelo(a.callsign);
    }
    console.log(
      `${a.distanciaKm.toFixed(1).padStart(5)} km ${RUMBOS[octante(a.acimut)].padEnd(2)}  ` +
      `${etiqueta(a).padEnd(9)} ${textoRuta(a).padEnd(12)} ` +
      `${(textoAvion(a) || "?").padEnd(20)} ${formatoAltitud(a.pies)}`
    );
  }
  guardarJSON(F_FICHA, fichas);
  guardarJSON(F_RUTA, rutas);
  await widget.presentMedium();
}

Script.complete();
