"use client";

import { PasswordInput } from "@/components/ui/PasswordInput";
import { KeyRound, Link2, Link2Off, Pencil, ShieldOff, Trash2, TriangleAlert, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createUser, deleteUser, forcePasswordChange, resetUserTwoFactor, unlinkGoogle, updateUser, allowGoogleRelink } from "@/actions/users";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/components/ui/cn";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "@/components/ui/clipboard";
import { useT } from "@/i18n/client";

type Role = "ADMIN" | "MEMBER";
interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  twoFactor: boolean;
  googleLinked: boolean;
  googleRelinkBlocked: boolean;
  privateProjects: number;
}

export function UsersAdmin({ users, meId, maxUsers, emailAvailable, noRecovery }: { users: UserRow[]; meId: string; maxUsers: number; emailAvailable: boolean; noRecovery?: boolean }) {
  const t = useT();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [resetting2fa, setResetting2fa] = useState<UserRow | null>(null);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const activeCount = users.filter((u) => u.active).length;

  const unlink = async (u: UserRow) => {
    const ok = await confirm({
      title: t("Desvincular Google de {name}", { name: u.name }),
      message: t("Se cerrarán sus sesiones. Tendrá que entrar con su contraseña: entrar con Google con el mismo email no vuelve a vincular la cuenta hasta que use su contraseña o tú pulses «Permitir Google». Los documentos de Drive no se ven afectados."),
      confirmLabel: t("Desvincular"),
      danger: true,
    });
    if (!ok) return;
    const res = await unlinkGoogle(u.id);
    if (!res.ok) return toast(res.error, "error");
    toast(t("Google desvinculado: se han cerrado sus sesiones"));
    router.refresh();
  };

  const allow = async (u: UserRow) => {
    const res = await allowGoogleRelink(u.id);
    if (!res.ok) return toast(res.error, "error");
    toast(t("Google permitido: podrá volver a vincularse al entrar con Google"));
    router.refresh();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("Usuarios")}</h2>
          <p className="text-sm text-slate-500">{t("{n} de {max} usuarios activos. No hay registro público: solo un administrador puede dar de alta usuarios.", { n: activeCount, max: maxUsers })}</p>
        </div>
        <button className="btn-primary ml-auto" onClick={() => setCreating(true)} disabled={activeCount >= maxUsers}>
          <UserPlus size={16} /> {t("Nuevo usuario")}
        </button>
      </div>
      {noRecovery && (
        <p role="note" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          {t("No hay email ni inicio de sesión con Google configurados: quien olvide su contraseña no puede recuperarla por su cuenta y tendrá que pedirte que le fuerces el cambio de contraseña.")}
        </p>
      )}
      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {users.map((u) => (
          <li key={u.id} className={cn("flex items-center gap-3 px-4 py-3", !u.active && "opacity-50")}>
            <Avatar id={u.id} name={u.name} size="md" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {u.name} {u.id === meId && <span className="text-xs text-slate-500">{t("(tú)")}</span>}
              </div>
              <div className="truncate text-xs text-slate-500">{u.email}</div>
            </div>
            <span className={cn("badge", u.role === "ADMIN" ? "bg-brand-50 text-brand-700 ring-brand-500/20" : "bg-slate-100 text-slate-600 ring-slate-500/20")}>
              {u.role === "ADMIN" ? t("Admin") : t("Miembro")}
            </span>
            {!u.active && <span className="badge bg-slate-100 text-slate-500 ring-slate-400/20">{t("Inactivo")}</span>}
            {u.mustChangePassword && <span className="badge bg-amber-50 text-amber-700 ring-amber-500/20" title={t("Tiene que elegir una contraseña nueva al entrar")}>{t("Contraseña pendiente")}</span>}
            {u.twoFactor && <span className="badge bg-emerald-50 text-emerald-700 ring-emerald-500/20" title={t("Tiene activada la verificación en dos pasos")}>2FA</span>}
            {u.googleLinked && <span className="badge bg-slate-100 text-slate-600 ring-slate-500/20" title={t("Ha entrado con Google")}>Google</span>}
            {u.googleRelinkBlocked && <span className="badge bg-amber-50 text-amber-700 ring-amber-500/20" title={t("Google desvinculado: no se vuelve a enlazar solo")}>{t("Google bloqueado")}</span>}
            <button className="btn-icon" onClick={() => setEditing(u)} aria-label={t("Editar {name}", { name: u.name })}><Pencil size={16} /></button>
            {u.id !== meId && (
              <button className="btn-icon" onClick={() => setResetting(u)} aria-label={t("Forzar cambio de contraseña de {name}", { name: u.name })} title={t("Forzar cambio de contraseña")}><KeyRound size={16} /></button>
            )}
            {u.id !== meId && u.twoFactor && (
              <button className="btn-icon" onClick={() => setResetting2fa(u)} aria-label={t("Restablecer la verificación en dos pasos de {name}", { name: u.name })} title={t("Restablecer la verificación en dos pasos")}><ShieldOff size={16} /></button>
            )}
            {u.id !== meId && u.googleLinked && (
              <button className="btn-icon" onClick={() => void unlink(u)} aria-label={t("Desvincular Google de {name}", { name: u.name })} title={t("Desvincular Google")}><Link2Off size={16} /></button>
            )}
            {u.googleRelinkBlocked && (
              <button className="btn-icon" onClick={() => void allow(u)} aria-label={t("Permitir Google a {name}", { name: u.name })} title={t("Permitir Google")}><Link2 size={16} /></button>
            )}
            {u.id !== meId && (
              <button className="btn-icon text-red-600 dark:text-red-400" onClick={() => setDeleting(u)} aria-label={t("Borrar {name}", { name: u.name })}><Trash2 size={16} /></button>
            )}
          </li>
        ))}
      </ul>
      {creating && <UserForm emailAvailable={emailAvailable} onClose={() => setCreating(false)} />}
      {editing && <UserForm user={editing} isMe={editing.id === meId} onClose={() => setEditing(null)} />}
      {resetting && <ForcePasswordChange user={resetting} emailAvailable={emailAvailable} onClose={() => setResetting(null)} />}
      {resetting2fa && <ResetTwoFactor user={resetting2fa} onClose={() => setResetting2fa(null)} />}
      {deleting && <DeleteUser user={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function UserForm({ user, isMe, emailAvailable, onClose }: { user?: UserRow; isMe?: boolean; emailAvailable?: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "MEMBER");
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = user ? await updateUser(user.id, { name, email, role, active }) : await createUser({ name, email, role, password: emailAvailable ? undefined : password });
      if (!res.ok) return toast(res.error, "error");
      toast(user ? t("Usuario actualizado") : emailAvailable ? t("Usuario creado: le hemos enviado una invitación por email") : t("Usuario creado"));
      router.refresh();
      onClose();
    });
  };

  return (
    <Modal open onClose={onClose} title={user ? t("Editar usuario") : t("Nuevo usuario")} size="sm">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="u-name">{t("Nombre")}</label>
          <input id="u-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required data-autofocus />
        </div>
        <div>
          <label className="label" htmlFor="u-email">Email</label>
          <input id="u-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} required autoComplete="off" />
        </div>
        {!user && emailAvailable && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            {t("Recibirá un email con un enlace (válido 72 horas) para elegir su propia contraseña. Tú no la llegas a conocer.")}
          </p>
        )}
        {!user && !emailAvailable && (
          <div>
            <label className="label" htmlFor="u-pass">{t("Contraseña inicial (mín. 10)")}</label>
            <PasswordInput id="u-pass" className="input" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required autoComplete="new-password" />
            <p className="mt-1 text-xs text-slate-500">
              {t("El envío de emails no está configurado: dale esta clave por otro medio. Al entrar tendrá que elegir una contraseña nueva, así que tú no llegarás a conocer la definitiva.")}
            </p>
          </div>
        )}
        {user && user.email !== email && emailAvailable && (
          <p className="text-xs text-amber-700 dark:text-amber-300">{t("Se avisará por email a la dirección antigua del cambio.")}</p>
        )}
        <div>
          <label className="label" htmlFor="u-role">{t("Rol")}</label>
          <select id="u-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isMe}>
            <option value="MEMBER">{t("Miembro")}</option>
            <option value="ADMIN">{t("Administrador")}</option>
          </select>
        </div>
        {user && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={isMe} />
            {t("Usuario activo (si lo desactivas, se cierran sus sesiones)")}
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn-primary" disabled={pending}>{user ? t("Guardar") : t("Crear usuario")}</button>
        </div>
      </form>
    </Modal>
  );
}

function ForcePasswordChange({ user, emailAvailable, onClose }: { user: UserRow; emailAvailable: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const run = (copyLink: boolean) =>
    start(async () => {
      const res = await forcePasswordChange(user.id, { copyLink });
      if (!res.ok) return toast(res.error, "error");
      router.refresh();
      if (res.data.link) return setLink(res.data.link);
      toast(res.data.emailed ? t("Cambio forzado: se han cerrado sus sesiones y le hemos enviado un enlace por email") : t("Cambio forzado: se han cerrado sus sesiones"));
      onClose();
    });
  if (link) {
    return (
      <Modal open onClose={onClose} title={t("Enlace para {name}", { name: user.name })} size="sm">
        <div className="space-y-3 text-sm">
          <p>{t("Sus sesiones están cerradas. Con este enlace elegirá una contraseña nueva.")}</p>
          <input className="input font-mono text-xs" value={link} readOnly onFocus={(e) => e.currentTarget.select()} aria-label={t("Enlace de restablecimiento")} data-testid="reset-link" />
          <p className="text-amber-700 dark:text-amber-300">{t("Envíaselo por un canal de confianza; caduca en 30 minutos y sirve una sola vez. No volverá a mostrarse.")}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t("Cerrar")}</button>
            <button type="button" className="btn-primary" onClick={async () => ((await copyText(link)) ? toast(t("Enlace copiado")) : toast(t("No se pudo copiar"), "error"))}>{t("Copiar enlace")}</button>
          </div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={t("Forzar cambio de contraseña de {name}", { name: user.name })} size="sm">
      <form
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          run(false);
        }}
      >
        <p>{t("Se cerrarán todas sus sesiones y tendrá que elegir una contraseña nueva la próxima vez que entre. Tú no escribes ninguna contraseña.")}</p>
        <p className="text-slate-500">
          {emailAvailable
            ? t("Le enviaremos un enlace por email (válido 30 minutos) para elegirla.")
            : t("El envío de emails no está configurado: se generará un enlace de un solo uso (válido 30 minutos) para que se lo pases tú por un canal de confianza. Así puede recuperar el acceso aunque no recuerde la contraseña actual.")}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
          {emailAvailable && <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(true)}>{t("Copiar enlace en lugar de enviarlo")}</button>}
          <button className="btn-primary" disabled={pending}>{emailAvailable ? t("Forzar cambio") : t("Generar enlace")}</button>
        </div>
      </form>
    </Modal>
  );
}

function ResetTwoFactor({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <Modal open onClose={onClose} title={t("Restablecer la verificación en dos pasos de {name}", { name: user.name })} size="sm">
      <form
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await resetUserTwoFactor(user.id);
            if (!res.ok) return toast(res.error, "error");
            toast(t("Verificación en dos pasos restablecida"));
            router.refresh();
            onClose();
          });
        }}
      >
        <p>{t("Se borrarán su método y sus códigos de recuperación. Si es administrador, tendrá que configurar uno nuevo antes de entrar con contraseña; si es miembro, puede volver a activarlo desde «Mi perfil».")}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn-primary" disabled={pending}>{t("Restablecer")}</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteUser({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const count = user.privateProjects;
  return (
    <Modal open onClose={onClose} title={t("Borrar a {name}", { name: user.name })} size="sm">
      <form
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await deleteUser(user.id, count > 0 && confirmed);
            if (!res.ok) return toast(res.error, "error");
            toast(count ? t("Usuario y proyectos privados borrados") : t("Usuario borrado"));
            router.refresh();
            onClose();
          });
        }}
      >
        <p>{t("Se borrará su cuenta para siempre. En los proyectos compartidos sus tareas y comentarios se conservan, sin autor, y deja de ser miembro de los proyectos privados con más gente. Si solo quieres quitarle el acceso, desactívalo.")}</p>
        {count > 0 && (
          <div className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            <p className="flex gap-2 font-medium">
              <TriangleAlert size={18} className="shrink-0" />
              {count === 1 ? t("Es el único miembro de 1 proyecto privado.") : t("Es el único miembro de {n} proyectos privados.", { n: count })} {t("Se borrarán con todas sus tareas, releases y adjuntos, y no se pueden recuperar.")}
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              {count === 1 ? t("Entiendo que se borra su proyecto privado") : t("Entiendo que se borran sus proyectos privados")}
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn-primary bg-red-600 hover:bg-red-700" disabled={pending || (count > 0 && !confirmed)}>{t("Borrar usuario")}</button>
        </div>
      </form>
    </Modal>
  );
}
