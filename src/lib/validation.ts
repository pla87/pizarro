import "./zod-config";
import { z } from "zod";
import { mentionsToPlain } from "./mentions";
import { MAX_CLIENT, MAX_COST, MAX_HOURS, TASK_PRIORITIES } from "./task-fields";
import { FILE_MAX_MAX_MB, FILE_MAX_MIN_MB } from "./upload-size";
import { COLUMN_ROLES, HEX_COLOR_RE, MAX_DESCRIPTION, MAX_TITLE, PALETTE, RELEASE_ZIP_MAX_MB, RELEASE_ZIP_MIN_MB } from "./constants";

export const id = z.string().min(1).max(40);
export const title = z.string().trim().min(1, "El título es obligatorio.").max(MAX_TITLE, "Máximo 210 caracteres.");
/** Título de tarea: admite menciones @[Nombre](user:ID); el límite de 210 caracteres cuenta el texto visible. */
export const taskTitle = z
  .string()
  .trim()
  .min(1, "El título es obligatorio.")
  .max(MAX_TITLE * 2, "Máximo 210 caracteres.")
  .refine((v) => mentionsToPlain(v).length <= MAX_TITLE, "Máximo 210 caracteres.");
export const attachLimitMb = z
  .number("Tamaño no válido.")
  .int("Tamaño no válido.")
  .min(RELEASE_ZIP_MIN_MB, `El mínimo es ${RELEASE_ZIP_MIN_MB} MB.`)
  .max(RELEASE_ZIP_MAX_MB, `El máximo es ${RELEASE_ZIP_MAX_MB} MB.`);
export const fileMaxMb = z
  .number("Tamaño no válido.")
  .int("Tamaño no válido.")
  .min(FILE_MAX_MIN_MB, `El mínimo es ${FILE_MAX_MIN_MB} MB.`)
  .max(FILE_MAX_MAX_MB, `El máximo es ${FILE_MAX_MAX_MB} MB.`);
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

// --- Campos opcionales de las tareas (lib/task-fields.ts) ---

/** Decimal no negativo con hasta dos decimales (acepta coma o punto); "" o null lo quita. Sale como texto «12.50». */
function decimalField(max: number, message: string) {
  return z
    .union([z.string(), z.number()])
    .nullable()
    .transform((val, ctx) => {
      if (val === null) return null;
      const raw = typeof val === "number" ? String(val) : val.trim().replace(",", ".");
      if (raw === "") return null;
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(raw) || Number(raw) > max) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return Number(raw).toFixed(2);
    });
}
export const taskCost = decimalField(MAX_COST, "El coste debe ser un importe entre 0 y 9.999.999.999,99.");
export const taskHours = decimalField(MAX_HOURS, "Las horas deben ser un número entre 0 y 99.999,99.");
export const taskPriority = z.enum(TASK_PRIORITIES).nullable();
export const taskClient = z
  .string()
  .trim()
  .max(MAX_CLIENT, "El cliente admite como máximo 120 caracteres.")
  .transform((c) => (c === "" ? null : c))
  .nullable();
