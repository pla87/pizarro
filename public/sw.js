// Service worker mínimo: permite instalar Tablón como app. No guarda nada en caché
// (todos los datos son privados y deben venir siempre del servidor).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
