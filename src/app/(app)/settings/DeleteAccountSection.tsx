"use client";

import { CircleCheck, Info, TriangleAlert, UserX } from "lucide-react";
import { useState } from "react";
import { useActionTransition } from "@/components/useActionTransition";
import { deleteMyAccount, sendAccountDeleteCode } from "@/actions/profile";
import { clearDraftsOnLogout } from "@/components/board/drafts";
import { Modal } from "@/components/ui/Modal";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { ACCOUNT_DELETE_PURPOSE, type GoogleReauthResult } from "@/lib/google-reauth";
import { confirmWordMatches, DELETE_ACCOUNT_WORD, DELETION_BLOCK_MESSAGES, type DeleteFactor, type DeletionBlock } from "@/lib/user-delete-core";

interface Props {
  /** Por qué no se puede borrar (única cuenta o último administrador); null si se puede. */
  block: DeletionBlock | null;
  /** Proyectos privados en los que es el único miembro: pasan a ser de equipo, o se borran con la cuenta si lo pide. */
  privateProjects: { id: string; name: string }[];
  twoFactor: "TOTP" | "EMAIL" | null;
  emailAvailable: boolean;
  /** Puede confirmar con su contraseña (con «solo Google», solo el acceso de emergencia de los administradores). */
  passwordLogin: boolean;
  /** Otras formas de confirmar para quien entra con Google (deleteAlternatives); vacío: solo la contraseña. */
  alternatives: DeleteFactor[];
  /** Ya ha vuelto a entrar con Google desde esta sesión (10 minutos). */
  googleConfirmed: boolean;
  /** Vuelta de Google («?delete=…»): abre el diálogo con el resultado. */
  reauth: GoogleReauthResult | null;
}

/** «Borrar mi cuenta» (al final de la pestaña «Cuenta»): el mismo borrado que hace un administrador desde «Usuarios». */
export function DeleteAccountSection({ block, ...props }: Props) {
  const t = useT();
  const [open, setOpen] = useState(!block && props.reauth !== null);
  return (
    <section className="card p-5" id="delete-account">
      <h2 className="flex items-center gap-2 font-semibold"><UserX size={18} /> {t("Borrar mi cuenta")}</h2>
      {block ? (
        <>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300" data-testid="delete-account-block">{t(DELETION_BLOCK_MESSAGES[block])}</p>
          {block === "only-user" && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
              <Info size={14} className="mt-0.5 shrink-0" />
              {t("Si quieres dejar Pizarro, borra la instalación.")}
            </p>
          )}
        </>
      ) : (
        <p className="mt-0.5 text-sm text-slate-500">{t("Para siempre. Lo que creaste se queda, sin tu nombre.")}</p>
      )}
      <button type="button" className="btn-danger mt-3" disabled={!!block} onClick={() => setOpen(true)}>{t("Borrar mi cuenta")}</button>
      {open && <DeleteAccountDialog {...props} onClose={() => setOpen(false)} />}
    </section>
  );
}

function DeleteAccountDialog({ privateProjects, twoFactor, emailAvailable, passwordLogin, alternatives, googleConfirmed, reauth, onClose }: Omit<Props, "block"> & { onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useActionTransition();
  // Sin la contraseña: quien entra con Google y quizá no la conoce (o ya ha vuelto a entrar con Google).
  const [withoutPassword, setWithoutPassword] = useState(!passwordLogin || (alternatives.length > 0 && (googleConfirmed || reauth !== null)));
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [word, setWord] = useState("");
  const [deleteProjects, setDeleteProjects] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const confirmWord = t(DELETE_ACCOUNT_WORD);
  const withGoogle = withoutPassword && googleConfirmed && alternatives.includes("google");
  const withCode = withoutPassword && !withGoogle && (alternatives.includes("totp") || alternatives.includes("email"));
  const proven = withoutPassword ? withGoogle || (withCode && !!code.trim()) : !!password && (!twoFactor || !!code.trim());
  const ready = proven && confirmWordMatches(word, confirmWord);
  const count = privateProjects.length;

  const sendCode = () =>
    start(async () => {
      const res = await sendAccountDeleteCode();
      if (!res.ok) return void toast(res.error, "error");
      setCodeSent(true);
      toast(t("Te hemos enviado un código a tu email."), "success");
    });

  const submit = () =>
    start(async () => {
      const deleteIds = count > 0 && deleteProjects ? privateProjects.map((p) => p.id) : [];
      const res = withoutPassword
        ? await deleteMyAccount({ method: withGoogle ? "google" : "code", code: withGoogle ? undefined : code, deleteProjects: deleteIds })
        : await deleteMyAccount({ method: "password", password, code: twoFactor ? code : undefined, deleteProjects: deleteIds });
      if (!res.ok) return void toast(res.error, "error");
      // La cuenta ya no existe: fuera también todos los borradores de este navegador.
      clearDraftsOnLogout(true);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- recarga completa a propósito: el acceso sale en el idioma de la instalación y sin nada de la cuenta en memoria
      window.location.assign("/login?info=account_deleted");
    });

  // Código de la verificación en dos pasos (con la contraseña) o, sin ella, el de la app o el del email.
  const codeField = (help: string, emailButton: boolean) => (
    <div>
      <label className="label" htmlFor="da-code">{t("Código de verificación")}</label>
      <div className="flex gap-2">
        <input id="da-code" className="input" autoComplete="one-time-code" spellCheck={false} maxLength={40} autoFocus={withoutPassword} value={code} onChange={(e) => setCode(e.target.value)} />
        {emailButton && (
          <button type="button" className="btn-secondary shrink-0" disabled={pending} onClick={sendCode}>{codeSent ? t("Reenviar") : t("Enviar código")}</button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">{help}</p>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      placement="top"
      title={t("Borrar mi cuenta")}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
          <button type="submit" form="delete-account-form" className="btn-danger" disabled={pending || !ready}>{t("Borrar mi cuenta")}</button>
        </>
      }
    >
      <form
        id="delete-account-form"
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !pending) submit();
        }}
      >
        <p className="font-medium">{t("No se puede deshacer.")}</p>
        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <Info size={14} className="mt-0.5 shrink-0" />
          {t("Se cierran tus sesiones y se borran tus datos. Tus tareas y comentarios se quedan como «Usuario eliminado».")}
        </p>
        {count > 0 && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200" data-testid="delete-account-private">
            <p className="flex gap-2 font-medium">
              <TriangleAlert size={18} className="shrink-0" />
              {count === 1
                ? t("Eres el único miembro de este proyecto privado. Al borrar tu cuenta pasará a ser un proyecto de equipo y lo verán los administradores:")
                : t("Eres el único miembro de estos proyectos privados. Al borrar tu cuenta pasarán a ser proyectos de equipo y los verán los administradores:")}
            </p>
            <ul className="max-h-32 list-disc space-y-0.5 overflow-y-auto pl-9" data-testid="delete-account-private-list">
              {privateProjects.map((p) => <li key={p.id} className="break-words">{p.name}</li>)}
            </ul>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={deleteProjects} onChange={(e) => setDeleteProjects(e.target.checked)} />
              {count === 1 ? t("Borrar también este proyecto") : t("Borrar también estos proyectos")}
            </label>
            {deleteProjects && (
              <p className="font-medium text-red-700 dark:text-red-300">{t("Se borrarán con todas sus tareas, releases y adjuntos, y no se pueden recuperar.")}</p>
            )}
          </div>
        )}
        {!withoutPassword ? (
          <>
            <div>
              <label className="label" htmlFor="da-pass">{t("Contraseña actual")}</label>
              <PasswordInput id="da-pass" className="input" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {twoFactor && codeField(twoFactor === "TOTP" ? t("De tu app o un código de recuperación.") : t("Del email o un código de recuperación."), twoFactor === "EMAIL" && emailAvailable)}
            {alternatives.length > 0 && (
              <button type="button" className="text-left text-sm text-brand-700 hover:underline dark:text-brand-300" onClick={() => (setWithoutPassword(true), setCode(""))}>
                {t("Entro con Google y no conozco mi contraseña")}
              </button>
            )}
          </>
        ) : (
          <>
            {reauth === "google_mismatch" && !googleConfirmed && (
              <p role="alert" className="text-red-700 dark:text-red-300">{t("Esa cuenta de Google no es la de tu cuenta de Pizarro.")}</p>
            )}
            {reauth === "google_failed" && !googleConfirmed && (
              <p role="alert" className="text-red-700 dark:text-red-300">{t("No se pudo confirmar con Google. Vuelve a intentarlo.")}</p>
            )}
            {withGoogle ? (
              <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300" data-testid="delete-account-google-ok">
                <CircleCheck size={18} className="shrink-0" />
                {t("Has vuelto a entrar con Google: ya puedes borrar tu cuenta.")}
              </p>
            ) : alternatives.includes("totp") ? (
              codeField(t("De tu app o un código de recuperación."), false)
            ) : (
              <>
                <p>{t("Confírmalo con un código por email o volviendo a entrar con Google.")}</p>
                {alternatives.includes("email") && codeField(t("Pulsa «Enviar código» y escribe el que te llegue al email."), true)}
                {alternatives.includes("google") && (
                  // Navegación completa: Google vuelve a «Mi perfil → Cuenta» con este diálogo abierto.
                  <a href={`/api/auth/google/start?purpose=${ACCOUNT_DELETE_PURPOSE}`} className="btn-secondary w-full">{t("Volver a entrar con Google")}</a>
                )}
              </>
            )}
            {alternatives.length === 0 && (
              <p>{t("No hay otra forma de confirmarlo en este servidor: pide a un administrador que borre tu cuenta.")}</p>
            )}
            {passwordLogin && (
              <button type="button" className="text-left text-sm text-brand-700 hover:underline dark:text-brand-300" onClick={() => (setWithoutPassword(false), setCode(""))}>
                {t("Usar mi contraseña")}
              </button>
            )}
          </>
        )}
        <div>
          <label className="label" htmlFor="da-word">{t("Escribe {word} para confirmar", { word: confirmWord })}</label>
          <input id="da-word" className="input" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={word} onChange={(e) => setWord(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
