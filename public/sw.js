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
    // Silueta blanca sobre transparente: Android solo pinta el canal alfa del badge en la barra de estado (con el icono a
    // color salía un cuadrado blanco). Se genera con scripts/push-badge.mjs.
    badge: "/push-badge.png",
    // Vibración corta; con tag, un aviso nuevo con la misma etiqueta vuelve a sonar/vibrar en vez de cambiar en silencio.
    vibrate: [120, 60, 120],
    tag: text(data.tag, 80) || undefined,
    renotify: Boolean(text(data.tag, 80)),
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

// El navegador cambió o caducó la suscripción push: se vuelve a suscribir con la misma clave pública VAPID y se avisa al
// servidor para que cambie la fila de este dispositivo (POST /api/push/renew, con la cookie de sesión; el servidor solo
// sustituye una suscripción propia de esa sesión, reconocida por la huella de la vieja). Sin la suscripción vieja no hay
// forma de saber cuál cambiar: entonces lo hace la página al abrirse (resincronización en push-sync.ts).
function keyBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function renewSubscription(event) {
  const old = event.oldSubscription;
  if (!old) return;
  let sub = event.newSubscription || (await self.registration.pushManager.getSubscription());
  if (!sub || sub.endpoint === old.endpoint) {
    let key = old.options && old.options.applicationServerKey;
    if (!key) {
      const res = await fetch("/api/push/renew", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
      key = keyBytes((await res.json()).publicKey);
    }
    sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  const json = sub.toJSON();
  await fetch("/api/push/renew", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldHash: await sha256Hex(old.endpoint), endpoint: json.endpoint, keys: json.keys }),
  });
}
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(renewSubscription(event).catch(() => {}));
});
