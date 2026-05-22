// Service Worker per offlinedemo.
// Pre-cache selettivo di SAPUI5 (self-hosting) + cache strategica delle risorse app.

try {
    importScripts("./sw-ui5-manifest.js");
} catch (e) {
    self.UI5_PRE_CACHE = [];
}

const CACHE_NAME = "offlinedemo-v2";

const APP_PRE_CACHE = [
    "./",
    "./index.html",
    "./manifest.json",
    "./Component.js",
    "./controller/App.controller.js",
    "./controller/OfflineDemo.controller.js",
    "./view/App.view.xml",
    "./view/OfflineDemo.view.xml",
    "./model/models.js",
    "./i18n/i18n.properties",
    "./css/style.css",
    // suoni sorgente per notifica audio
    "./media/sounds/Chord2.wav",
    "./media/sounds/Chord2_Rev.wav",
    "./media/sounds/Cloud.wav"
];

function toRelative(path) {
    return path.startsWith("/") ? "." + path : path;
}

const PRE_CACHE = [
    ...APP_PRE_CACHE,
    ...(self.UI5_PRE_CACHE || []).map(toRelative)
];

// INSTALL
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            await Promise.all(
                PRE_CACHE.map((url) =>
                    cache.add(url).catch((err) => {
                        console.error("[SW] pre-cache FALLITO per", url, err.message);
                    })
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// ACTIVATE
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// FETCH
self.addEventListener("fetch", (event) => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== "GET") return;
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    if (url.hostname.endsWith("sap.lasmobili.it")) return;
    if (url.origin !== self.location.origin) return;

    
    if (url.searchParams.has("_probe")) {
        event.respondWith(
            fetch(request, { cache: "no-store" }).catch(() => Response.error())
        );
        return;
    }


    if (request.mode === "navigate") {
        event.respondWith(navigationHandler(request));
        return;
    }

    if (url.pathname.includes("/resources/")) {
        event.respondWith(cacheFirst(request));
        return;
    }

    if (url.pathname.endsWith(".wav") ||
        url.pathname.endsWith(".mp3") ||
        url.pathname.endsWith(".ogg")) {
        event.respondWith(cacheFirst(new Request(event.request.url)));
        return;
    }

    if (isAppAsset(url.pathname)) {
        event.respondWith(cacheFirst(request));
        return;
    }

    event.respondWith(networkFirst(request));
});

function isAppAsset(pathname) {
    return (
        pathname.endsWith("/") ||
        pathname.endsWith("/index.html") ||
        pathname.endsWith("/manifest.json") ||
        pathname.endsWith("/Component.js") ||
        pathname.endsWith(".controller.js") ||
        pathname.endsWith(".view.xml") ||
        pathname.endsWith("/models.js") ||
        pathname.endsWith("/i18n.properties") ||
        pathname.endsWith("/style.css") ||
        pathname.endsWith("/sw-ui5-manifest.js") ||
        // inclusione formato audio
        pathname.endsWith(".wav")
    );
}

// STRATEGIE

// Navigation request verso index.html
async function navigationHandler(request) {
    try {
        const response = await fetch(request);
        if (response && response.ok && response.type === "basic") {
            const cache = await caches.open(CACHE_NAME);
            // Salva index.html sotto la chiave canonica "./index.html"
            cache.put("./index.html", response.clone());
        }
        return response;
    } catch (err) {
        // Offline: forza index.html da cache, ignora ulteriore risorse
        const cached = await caches.match("./index.html", { ignoreSearch: true });
        if (cached) return cached;
        // in fallback, tenta root
        const fallback = await caches.match("./", { ignoreSearch: true });
        if (fallback) return fallback;
        return new Response(
            "<h1>App non disponibile offline</h1><p>Ricarica quando la connessione è disponibile.</p>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
    }
}

async function cacheFirst(request) {
    // Per richieste audio con Range header, cerca la risposta completa
    // e costruisci una risposta parziale manualmente
    const isRange = request.headers.has("Range");
    const cacheKey = isRange ? new Request(request.url) : request;

    const cached = await caches.match(cacheKey, { ignoreSearch: true });

    if (cached) {
        if (isRange) {
            // Restituisci l'intero body come 200: i browser accettano
            // una risposta 200 anche quando si aspettano una 206
            return cached;
        }
        return cached;
    }

    try {
        const response = await fetch(request);
        if (response && response.ok && (response.type === "basic" || response.type === "cors")) {
            const cache = await caches.open(CACHE_NAME);
            // Salva sempre la risposta completa (non la range response)
            cache.put(new Request(request.url), response.clone());
        }
        return response;
    } catch (err) {
        return new Response("Risorsa non disponibile offline", {
            status: 503,
            statusText: "Service Unavailable"
        });
    }
}

async function networkFirst(request) {
    try {
        const response = await fetch(request);
        if (response && response.ok && response.type === "basic") {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch (err) {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        return new Response("Risorsa non disponibile offline", {
            status: 503,
            statusText: "Service Unavailable"
        });
    }
}