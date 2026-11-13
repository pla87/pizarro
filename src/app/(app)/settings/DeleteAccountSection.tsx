"use client";

import { Info, TriangleAlert, UserX } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteMyAccount, sendAccountDeleteCode } from "@/actions/profile";
import { clearDraftsOnLogout } from "@/components/board/drafts";
import { Modal } from "@/components/ui/Modal";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { confirmWordMatches, DELETE_ACCOUNT_WORD, DELETION_BLOCK_MESSAGES, type DeletionBlock } from "@/lib/user-delete-core";

interface Props {
  /** Por qué no se puede borrar (única cuenta o último administrador); null si se puede. */
  block: DeletionBlock | null;
  /** Proyectos privados en los que es el único miembro: se borran con la cuenta. */
  privateProjects: number;
  twoFactor: "TOTP" | "EMAIL" | null;
  emailAvailable: boolean;
}

/** «Borrar mi cuenta» (al final de la pestaña «Cuenta»): el mismo borrado que hace un administrador desde «Usuarios». */
export function DeleteAccountSection({ block, privateProjects, twoFactor, emailAvailable }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
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
      {open && <DeleteAccountDialog privateProjects={privateProjects} twoFactor={twoFactor} emailAvailable={emailAvailable} onClose={() => setOpen(false)} />}
    </section>
  );
}

function DeleteAccountDialog({ privateProjects, twoFactor, emailAvailable, onClose }: Omit<Props, "block"> & { onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [word, setWord] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const confirmWord = t(DELETE_ACCOUNT_WORD);
  const ready = !!password && (!twoFactor || !!code.trim()) && confirmWordMatches(word, confirmWord) && (privateProjects === 0 || confirmed);

  const sendCode = () =>
    start(async () => {
      const res = await sendAccountDeleteCode();
      if (!res.ok) return void toast(res.error, "error");
      setCodeSent(true);
      toast(t("Te hemos enviado un código a tu email."), "success");
    });

  const submit = () =>
    start(async () => {
      const res = await deleteMyAccount({ password, code: twoFactor ? code : undefined, confirmPrivate: privateProjects > 0 && confirmed });
      if (!res.ok) return void toast(res.error, "error");
      // La cuenta ya no existe: fuera también todos los borradores de este navegador.
      clearDraftsOnLogout(true);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- recarga completa a propósito: el acceso sale en el idioma de la instalación y sin nada de la cuenta en memoria
      window.location.assign("/login?info=account_deleted");
    });

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
        {privateProjects > 0 && (
          <div className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            <p className="flex gap-2 font-medium">
              <TriangleAlert size={18} className="shrink-0" />
              {privateProjects === 1
                ? t("Tu proyecto privado se borra con todo lo que tiene.")
                : t("Tus {n} proyectos privados se borran con todo lo que tienen.", { n: privateProjects })}
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              {t("Entendido")}
            </label>
          </div>
        )}
        <div>
          <label className="label" htmlFor="da-pass">{t("Contraseña actual")}</label>
          <PasswordInput id="da-pass" className="input" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {twoFactor && (
          <div>
            <label className="label" htmlFor="da-code">{t("Código de verificación")}</label>
            <div className="flex gap-2">
              <input id="da-code" className="input" autoComplete="one-time-code" spellCheck={false} maxLength={40} value={code} onChange={(e) => setCode(e.target.value)} />
              {twoFactor === "EMAIL" && emailAvailable && (
                <button type="button" className="btn-secondary shrink-0" disabled={pending} onClick={sendCode}>{codeSent ? t("Reenviar") : t("Enviar código")}</button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {twoFactor === "TOTP" ? t("De tu app o un código de recuperación.") : t("Del email o un código de recuperación.")}
            </p>
          </div>
        )}
        <div>
          <label className="label" htmlFor="da-word">{t("Escribe {word} para confirmar", { word: confirmWord })}</label>
          <input id="da-word" className="input" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={word} onChange={(e) => setWord(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
