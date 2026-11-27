import "server-only";
import { todayIso } from "./dates";
import { db } from "./db";
import { appTimeZone } from "./format";
import { startOfDayInZone } from "./log-range";
import { rateLimit, rateLimitCount, rateLimitReached } from "./rate-limit";

// Tope DIARIO de avisos por WhatsApp para toda la instalación (cada uno lo cobra Meta). Día natural en la zona de la
// instalación: la clave lleva el día (`whatsapp:day:2026-11-27`), así que a medianoche empieza otra cuenta sin esperar a
// que venza la ventana. El prefijo `whatsapp:` va al mapa de seguridad del limitador (un aluvión de claves baratas no lo
// borra). El contador está en memoria: al arrancar se rellena con los avisos que ya salieron hoy (`whatsappSentAt`), para
// que un reinicio o un despliegue no dé otros N mensajes.

/** La clave dura algo más de un día (los días con cambio de hora tienen 25 h); el día en la clave es lo que manda. */
const WINDOW_MS = 26 * 3600_000;
const dayKey = (day: string) => `whatsapp:day:${day}`;

interface Seed { day: string; ready: Promise<void> }
const SEED_GLOBAL = "__pzWhatsappDaySeed";
const seedSlot = () => globalThis as unknown as Record<string, Seed | undefined>;

function today(now: Date): { day: string; tz: string } {
  const tz = appTimeZone();
  return { day: todayIso(tz, now), tz };
}

/** Una vez por día y proceso: suma al contador los avisos por WhatsApp que ya constan como enviados hoy. */
function seeded(day: string, tz: string): Promise<void> {
  const cur = seedSlot()[SEED_GLOBAL];
  if (cur?.day === day) return cur.ready;
  const ready = db.notification
    .count({ where: { whatsappSentAt: { gte: startOfDayInZone(day, tz) } } })
    .then((n) => {
      if (n > 0) rateLimit(dayKey(day), Number.MAX_SAFE_INTEGER, WINDOW_MS, n);
    })
    // Sin base de datos se cuenta desde cero (el tope sigue valiendo para lo que se envíe a partir de ahora).
    .catch(() => {});
  seedSlot()[SEED_GLOBAL] = { day, ready };
  return ready;
}

/**
 * Reserva un aviso por WhatsApp de hoy. `ok: false` si ya se han enviado (o intentado) `limit`; `firstBlocked` es true
 * solo la primera vez que se rechaza en el día (para dejar una sola línea en Logs, no una por mensaje).
 */
export async function reserveWhatsappNotice(limit: number, now = new Date()): Promise<{ ok: true } | { ok: false; firstBlocked: boolean; day: string }> {
  const { day, tz } = today(now);
  await seeded(day, tz);
  const key = dayKey(day);
  // Comprobar y contar sin esperar nada entre medias: dos envíos a la vez no pasan del tope.
  if (rateLimitReached(key, limit)) return { ok: false, firstBlocked: rateLimit(`${key}:warned`, 1, WINDOW_MS), day };
  rateLimit(key, limit, WINDOW_MS);
  return { ok: true };
}

/** Avisos por WhatsApp de hoy (enviados o intentados) para «Hoy: N de M» en Integraciones. */
export async function whatsappNoticesToday(now = new Date()): Promise<number> {
  const { day, tz } = today(now);
  await seeded(day, tz);
  return rateLimitCount(dayKey(day));
}
