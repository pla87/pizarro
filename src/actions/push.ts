"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { runAction } from "@/lib/action";
import { describeAction } from "@/lib/action-context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { isRowId } from "@/lib/row-id";
import { requireUser } from "@/lib/session";
import { deviceLabel } from "@/lib/user-agent";
import { endpointHash, pushIcon, PushSubscribeError, pushView, savePushSubscription, sendPushToUser } from "@/lib/web-push";
import { PUSH_DEVICES_MAX } from "@/lib/web-push-core";
import { pushTestMessage } from "@/lib/web-push-text";
import { getT } from "@/i18n/server";

// Mi perfil → Avisos → «Avisos en este dispositivo» (avisos push del navegador). El endpoint y las claves de la
// suscripción nunca se pasan a runAction como args (irían al registro): son el secreto con el que se escribe a ese navegador.

const prefsSchema = z.object({ notifyMention: z.boolean(), notifyAssigned: z.boolean(), notifyDue: z.boolean(), notifyComment: z.boolean() });

/** Lo que necesita la sección (pushView), para rehacerla tras un cambio. Sin registro: es una lectura. */
export async function pushSetup() {
  return runAction(async () => {
    const user = await requireUser();
    return pushView(user.id, await getT());
  });
}

/** Activa los avisos en este navegador (la suscripción que dio pushManager.subscribe). */
export async function subscribePush(input: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  return runAction({ name: "profile.subscribePush" }, async () => {
    const user = await requireUser();
    if (!rateLimit(`messaging:push:subscribe:${user.id}`, 20, 10 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.", 429);
    const t = await getT();
    const ua = (await headers()).get("user-agent") ?? "";
    try {
      const r = await savePushSubscription(user.id, { endpoint: input?.endpoint, keys: input?.keys }, ua);
      describeAction(r.created ? "Activó los avisos push en {device}" : "Renovó los avisos push en {device}", { device: deviceLabel(ua, t) });
      return { id: r.id };
    } catch (err) {
      if (!(err instanceof PushSubscribeError)) throw err;
      if (err.reason === "limit") throw new AppError(t("Ya tienes {max} dispositivos con avisos. Quita alguno de la lista para activar este.", { max: PUSH_DEVICES_MAX }));
      if (err.reason === "service") throw new AppError("Este navegador usa un servicio de avisos que Pizarro no admite.");
      throw new AppError("El navegador ha dado una suscripción no válida. Vuelve a intentarlo.");
    }
  });
}

/** Desactiva los avisos en este navegador (por su endpoint, solo si es de esta persona). */
export async function unsubscribePush(input: { endpoint: string }) {
  return runAction({ name: "profile.unsubscribePush" }, async () => {
    const user = await requireUser();
    const endpoint = typeof input?.endpoint === "string" ? input.endpoint.slice(0, 2000) : "";
    const { count } = await db.pushSubscription.deleteMany({ where: { userId: user.id, endpointHash: endpointHash(endpoint) } });
    describeAction("Desactivó los avisos push en este dispositivo", { removed: count });
  });
}

/** Quita un dispositivo de la lista (p. ej. un móvil perdido o un navegador que ya no usa). */
export async function removePushDevice(id: string) {
  return runAction({ name: "profile.removePushDevice", args: [id] }, async () => {
    const user = await requireUser();
    if (typeof id !== "string" || !isRowId(id)) throw new AppError("Ese dispositivo ya no está en la lista.", 404);
    const { count } = await db.pushSubscription.deleteMany({ where: { id, userId: user.id } });
    if (!count) throw new AppError("Ese dispositivo ya no está en la lista.", 404);
    describeAction("Quitó un dispositivo de los avisos push");
  });
}

/** Qué avisos salen por push (para todos sus dispositivos). */
export async function savePushPrefs(prefs: z.input<typeof prefsSchema>) {
  return runAction({ name: "profile.savePushPrefs", args: [prefs] }, async () => {
    const user = await requireUser();
    const p = prefsSchema.parse(prefs);
    await db.user.update({ where: { id: user.id }, data: { pushNotifyMention: p.notifyMention, pushNotifyAssigned: p.notifyAssigned, pushNotifyDue: p.notifyDue, pushNotifyComment: p.notifyComment } });
    describeAction("Cambió sus avisos push");
  });
}

/** «Probar»: un aviso de prueba a todos sus dispositivos. Con el tope de las pruebas de Telegram y WhatsApp. */
export async function testPush() {
  return runAction({ name: "profile.testPush", args: [] }, async () => {
    const user = await requireUser();
    if (!rateLimit(`messaging:mytest:${user.id}`, 5, 10 * 60_000)) throw new AppError("Demasiados intentos. Espera unos minutos.", 429);
    const t = await getT();
    const r = await sendPushToUser(user, pushTestMessage(t, await pushIcon()), { test: true });
    if (!r.sent && !r.failed && !r.expired) throw new AppError("Activa primero los avisos en este dispositivo.");
    describeAction("Probó sus avisos push", { sent: r.sent, failed: r.failed, expired: r.expired });
    return { sent: r.sent, failed: r.failed, expired: r.expired };
  });
}
