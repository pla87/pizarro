import { z } from "zod";
import { MAX_DESCRIPTION, MAX_TITLE, PALETTE, TASK_TYPES, COLUMN_ROLES } from "./constants";

export const id = z.string().min(1).max(40);
export const title = z.string().trim().min(1, "El título es obligatorio.").max(MAX_TITLE, `Máximo ${MAX_TITLE} caracteres.`);
export const name = z.string().trim().min(1, "El nombre es obligatorio.").max(80, "Máximo 80 caracteres.");
export const description = z.string().max(MAX_DESCRIPTION, "La descripción es demasiado larga.");
export const taskType = z.enum(TASK_TYPES);
export const columnRole = z.enum(COLUMN_ROLES);
export const color = z.enum(PALETTE).nullable();
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
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), "Fecha no válida.")
  .nullable();

/** Teléfono en formato internacional E.164: +34600111222. */
export const phoneE164 = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => v === "" || /^\+[1-9]\d{7,14}$/.test(v), "Usa el formato internacional, p. ej. +34600111222.")
  .transform((v) => (v === "" ? null : v));
