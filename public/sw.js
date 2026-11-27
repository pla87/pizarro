// Service worker mínimo: permite instalar Pizarro como app y recibir los avisos push del navegador (Mi perfil → Avisos →
// «Avisos en este dispositivo»). No guarda nada en caché (todos los datos son privados y deben venir siempre del servidor).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Ruta de la propia app («/p/…»); cualquier otra cosa (otro origen, «//host», «javascript:») pasa a la lista de avisos. */
function samePath(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/notifications", self.location.origin);
    return url.origin === self.location.origin ? url.pathname + url.search + url.hash : "/notifications";
  } catch {
    return "/notifications";
  }
}

// El servidor manda {title, body, url, tag, icon} cifrado (RFC 8291); el navegador ya lo entrega descifrado.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const title = text(data.title, 200) || "Pizarro";
  const options = {
    body: text(data.body, 200),
    icon: samePath(text(data.icon, 200) || "/icon.png"),
    badge: "/icon.png",
    tag: text(data.tag, 80) || undefined,
    data: { url: samePath(data.url) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Al pulsar el aviso: enfoca la pestaña de Pizarro que ya tenga esa dirección o abre una nueva (siempre del mismo origen).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(samePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = windows.find((c) => c.url === target);
      if (same && "focus" in same) return same.focus();
      return self.clients.openWindow(target);
    })(),
  );
});
