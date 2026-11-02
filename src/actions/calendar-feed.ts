"use server";

import { z } from "zod";
import { runAction } from "@/lib/action";
import { feedHttpsUrl, feedWebcalUrl, googleSubscribeUrl, hashFeedToken, newFeedToken } from "@/lib/calendar-feed-core";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { appUrl } from "@/lib/mail";
import { rateLimit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";

const scopeSchema = z.enum(["MINE", "ALL"]);

/** Direcciones del enlace; el token en claro solo existe en esta respuesta (en la BD queda su HMAC). */
function links(token: string) {
  const https = feedHttpsUrl(appUrl(), token);
  const webcal = feedWebcalUrl(https);
  return { https, webcal, google: googleSubscribeUrl(webcal) };
}

/** Genera el enlace de suscripción (o uno nuevo, que invalida el anterior). */
export async function createCalendarFeed(scope: "MINE" | "ALL") {
  return runAction({ name: "calendarFeed.create", args: [scope] }, async () => {
    const user = await requireUser();
    if (!rateLimit(`calfeed-gen:${user.id}`, 20, 60 * 60_000)) throw new AppError("Demasiados intentos. Espera un poco.");
    const token = newFeedToken();
    const data = { tokenHash: hashFeedToken(token), scope: scopeSchema.parse(scope), rotatedAt: new Date(), lastUsedAt: null };
    await db.calendarFeed.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
    return links(token);
  });
}

/** Cambia qué tareas incluye la suscripción sin cambiar la dirección. */
export async function setCalendarFeedScope(scope: "MINE" | "ALL") {
  return runAction({ name: "calendarFeed.setScope", args: [scope] }, async () => {
    const user = await requireUser();
    await db.calendarFeed.updateMany({ where: { userId: user.id }, data: { scope: scopeSchema.parse(scope) } });
  });
}

/** Desactiva la suscripción: la dirección deja de valer (para volver a usarla hay que generar otra). */
export async function disableCalendarFeed() {
  return runAction({ name: "calendarFeed.disable" }, async () => {
    const user = await requireUser();
    await db.calendarFeed.deleteMany({ where: { userId: user.id } });
  });
}
