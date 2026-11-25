import { decryptSecretInfo, encryptSecret } from "./keyring";
import { MAIL_PASS_KEY } from "./mail-settings-core";
import { GOOGLE_SECRET_KEY } from "./google-config-core";
import { TELEGRAM_SECRET_KEY, TELEGRAM_TOKEN_KEY, WHATSAPP_TOKEN_KEY } from "./messaging-core";
import { hashShareToken, isShareTokenShape } from "./share-out-core";

// Re-cifrado de todos los secretos guardados con la clave actual (node dist/rotate-keys.mjs), y las huellas de
// «Compartir fuera» rehechas con la clave actual de TOKEN_SECRET. Sin «server-only»: lo usa el script de línea de
// órdenes. Cada valor se actualiza solo si nadie lo ha cambiado mientras tanto.

/** Los campos cifrados de la base de datos: tabla, columna y nombre legible (`idField`: clave de la fila, «id» salvo en AppState; `where`: filtro fijo). */
interface EncryptedField {
  model: "user" | "loginChallenge" | "googleAccount" | "appState" | "columnShare";
  field: string;
  nullable: boolean;
  label: string;
  idField?: string;
  where?: Record<string, unknown>;
}

export const ENCRYPTED_FIELDS: readonly EncryptedField[] = [
  { model: "user", field: "totpSecretEnc", nullable: true, label: "Secretos TOTP (verificación en dos pasos)" },
  { model: "loginChallenge", field: "pendingSecretEnc", nullable: true, label: "Altas de 2FA en curso" },
  { model: "googleAccount", field: "refreshTokenEnc", nullable: false, label: "Google: tokens permanentes" },
  { model: "googleAccount", field: "accessTokenEnc", nullable: true, label: "Google: tokens de acceso" },
  { model: "appState", field: "value", nullable: false, idField: "key", where: { key: MAIL_PASS_KEY }, label: "Email: contraseña SMTP guardada en Ajustes" },
  { model: "appState", field: "value", nullable: false, idField: "key", where: { key: GOOGLE_SECRET_KEY }, label: "Google: secreto de cliente guardado en Ajustes" },
  { model: "appState", field: "value", nullable: false, idField: "key", where: { key: TELEGRAM_TOKEN_KEY }, label: "Telegram: token del bot guardado en Ajustes" },
  { model: "appState", field: "value", nullable: false, idField: "key", where: { key: TELEGRAM_SECRET_KEY }, label: "Telegram: secreto del webhook" },
  { model: "appState", field: "value", nullable: false, idField: "key", where: { key: WHATSAPP_TOKEN_KEY }, label: "WhatsApp: token guardado en Ajustes" },
  { model: "columnShare", field: "tokenEnc", nullable: true, label: "Compartir fuera: direcciones de las webs de las columnas" },
];

type Row = Record<string, string | null>;

/** Lo mínimo del cliente de Prisma que hace falta (así se prueba sin base de datos). */
interface RotationDelegate {
  findMany(args: { where: Record<string, unknown>; select: Record<string, true> }): Promise<Row[]>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, string> }): Promise<{ count: number }>;
}
export type RotationDb = Record<EncryptedField["model"], RotationDelegate>;

interface RotationCount {
  label: string;
  total: number;
  /** Ya cifrados con la clave actual. */
  current: number;
  /** Re-cifrados (o que se re-cifrarían, con dryRun). */
  rotated: number;
  /** Ninguna clave configurada los abre: se perderán (habrá que volver a configurar 2FA o reconectar Google). */
  unreadable: number;
}

export async function rotateEncryptedSecrets(
  db: RotationDb,
  opts: { dryRun?: boolean; env?: Record<string, string | undefined> } = {},
): Promise<RotationCount[]> {
  const env = opts.env ?? process.env;
  const out: RotationCount[] = [];
  for (const { model, field, nullable, label, idField = "id", where = {} } of ENCRYPTED_FIELDS) {
    const delegate = db[model];
    const rows = await delegate.findMany({ where: { ...where, ...(nullable ? { [field]: { not: null } } : {}) }, select: { [idField]: true, [field]: true } });
    const count: RotationCount = { label, total: rows.length, current: 0, rotated: 0, unreadable: 0 };
    for (const row of rows) {
      const value = row[field];
      if (!value) continue;
      let info;
      try {
        info = decryptSecretInfo(value, env);
      } catch {
        count.unreadable++;
        continue;
      }
      if (!info.stale) {
        count.current++;
        continue;
      }
      if (opts.dryRun) {
        count.rotated++;
        continue;
      }
      const { count: n } = await delegate.updateMany({ where: { [idField]: row[idField], [field]: value }, data: { [field]: encryptSecret(info.plain, env) } });
      // 0: lo ha cambiado la app entre medias (y ya lo habrá cifrado con la clave actual).
      if (n > 0) count.rotated++;
      else count.current++;
    }
    out.push(count);
  }
  return out;
}

/**
 * «Compartir fuera»: la huella con la que se busca cada enlace (tokenHash) es un HMAC con TOKEN_SECRET. Si esa clave
 * cambia, se rehace con la actual a partir del token cifrado (tokenEnc, que solo tienen los enlaces activos): así la
 * dirección sigue funcionando aunque se quite TOKEN_SECRET_PREVIOUS (o aunque no se pusiera). Un enlace sin token
 * legible no se puede rehacer: si su huella era de otra clave, ya no funciona (en su columna, «Crear un enlace nuevo»).
 * Se cuenta como en rotateEncryptedSecrets (`unreadable`: los que ninguna clave de cifrado abre).
 */
export async function rehashShareTokens(
  db: Pick<RotationDb, "columnShare">,
  opts: { dryRun?: boolean; env?: Record<string, string | undefined> } = {},
): Promise<RotationCount> {
  const env = opts.env ?? process.env;
  const rows = await db.columnShare.findMany({ where: { tokenEnc: { not: null }, tokenHash: { not: null } }, select: { id: true, tokenEnc: true, tokenHash: true } });
  const count: RotationCount = { label: "Compartir fuera: huellas de las direcciones (TOKEN_SECRET)", total: rows.length, current: 0, rotated: 0, unreadable: 0 };
  for (const row of rows) {
    let token: string;
    try {
      token = decryptSecretInfo(row.tokenEnc!, env).plain;
    } catch {
      count.unreadable++;
      continue;
    }
    if (!isShareTokenShape(token)) {
      count.unreadable++;
      continue;
    }
    const hash = hashShareToken(token, env);
    if (hash === row.tokenHash) {
      count.current++;
      continue;
    }
    if (opts.dryRun) {
      count.rotated++;
      continue;
    }
    // Solo si sigue con la misma huella (la app pudo crear otro enlace entre medias, ya con la clave actual).
    const { count: n } = await db.columnShare.updateMany({ where: { id: row.id, tokenHash: row.tokenHash }, data: { tokenHash: hash } });
    if (n > 0) count.rotated++;
    else count.current++;
  }
  return count;
}
