import { z } from "zod";
import { mentionsToPlain } from "./mentions";
import { COLUMN_ROLES, HEX_COLOR_RE, MAX_DESCRIPTION, MAX_TITLE, PALETTE } from "./constants";

export const id = z.string().min(1).max(40);
export const title = z.string().trim().min(1, "El título es obligatorio.").max(MAX_TITLE, "Máximo 200 caracteres.");
/** Título de tarea: admite menciones @[Nombre](user:ID); el límite de 200 caracteres cuenta el texto visible. */
export const taskTitle = z
  .string()
  .trim()
  .min(1, "El título es obligatorio.")
  .max(MAX_TITLE * 2, "Máximo 200 caracteres.")
  .refine((v) => mentionsToPlain(v).length <= MAX_TITLE, "Máximo 200 caracteres.");
export const name = z.string().trim().min(1, "El nombre es obligatorio.").max(80, "Máximo 80 caracteres.");
export const description = z.string().max(MAX_DESCRIPTION, "La descripción es demasiado larga.");
export const columnRole = z.enum(COLUMN_ROLES);
export const color = z.enum(PALETTE).nullable();
export const hexColor = z.string().regex(HEX_COLOR_RE, "Color no válido.").transform((c) => c.toLowerCase());
export const email = z.string().trim().toLowerCase().email("Email no válido.").max(200);

/** Solo enlaces http(s): evita javascript: y similares. */
export const linkUrl = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || /^https?:\/\/[^\s]+$/i.test(v), "El enlace debe empezar por http:// o https://")
  .nullable();

/** Fecha de día YYYY-MM-DD (o null para quitarla). */
export const dayIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida.")
  // Ida y vuelta exacta: rechaza 2026-02-31 (que Date convertiría en 3 de marzo) y años absurdos.
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    const year = Number(v.slice(0, 4));
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && year >= 1900 && year <= 2999;
  }, "Fecha no válida.")
  .nullable();

/** Teléfono en formato internacional E.164: +34600111222. */
export const phoneE164 = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => v === "" || /^\+[1-9]\d{7,14}$/.test(v), "Usa el formato internacional, p. ej. +34600111222.")
  .transform((v) => (v === "" ? null : v));
