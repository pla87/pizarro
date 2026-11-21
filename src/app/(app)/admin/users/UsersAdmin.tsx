"use client";

import { PasswordInput } from "@/components/ui/PasswordInput";
import { KeyRound, Link2, Link2Off, MailPlus, MoreHorizontal, Pencil, ShieldOff, Trash2, TriangleAlert, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createUser, deleteUser, forcePasswordChange, resendInvite, resetUserTwoFactor, unlinkGoogle, updateUser, allowGoogleRelink } from "@/actions/users";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/components/ui/cn";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { InfoTip } from "@/components/ui/InfoTip";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { copyText } from "@/components/ui/clipboard";
import { useT } from "@/i18n/client";
import { useActionTransition } from "@/components/useActionTransition";
import { actionThrowResult } from "@/lib/stale-action";
import { EmailSafe } from "@/components/ui/EmailSafe";

type Role = "ADMIN" | "MEMBER";
type UserLocale = "ES" | "EN";
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
  /** Ids de los proyectos privados de los que es el único miembro (sin nombres: los administradores no los ven). */
  privateProjects: string[];
  locale: UserLocale;
  /** Debe elegir contraseña y nunca ha entrado: se le puede reenviar la invitación. */
  invitePending: boolean;
}

export function UsersAdmin({ users, meId, maxUsers, emailAvailable, noRecovery, defaultLocale = "ES" }: { users: UserRow[]; meId: string; maxUsers: number; emailAvailable: boolean; noRecovery?: boolean; defaultLocale?: UserLocale }) {
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
    const res = await unlinkGoogle(u.id).catch((e) => actionThrowResult(e, t));
    if (!res.ok) return toast(res.error, "error");
    toast(t("Google desvinculado: se han cerrado sus sesiones"));
    router.refresh();
  };

  const [resending, setResending] = useState<string | null>(null);
  const resend = async (u: UserRow) => {
    setResending(u.id);
    try {
      const res = await resendInvite(u.id).catch((e) => actionThrowResult(e, t));
      if (!res.ok) return toast(res.error, "error");
      toast(t("Invitación reenviada a {email}: el enlace anterior ya no vale", { email: u.email }));
      router.refresh();
    } finally {
      setResending(null);
    }
  };

  const allow = async (u: UserRow) => {
    const res = await allowGoogleRelink(u.id).catch((e) => actionThrowResult(e, t));
    if (!res.ok) return toast(res.error, "error");
    toast(t("Google permitido: podrá volver a vincularse al entrar con Google"));
    router.refresh();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("Usuarios")}</h2>
          <p className="flex items-center gap-1 text-sm text-slate-500">
            {t("{n} de {max} usuarios activos", { n: activeCount, max: maxUsers })}
            <InfoTip topic={t("Usuarios")}>{t("No hay registro público: solo un administrador da de alta usuarios.")}</InfoTip>
          </p>
        </div>
        <button className="btn-primary ml-auto" onClick={() => setCreating(true)} disabled={activeCount >= maxUsers} title={activeCount >= maxUsers ? t("Ya hay {max} usuarios activos, el máximo", { max: maxUsers }) : undefined}>
          <UserPlus size={16} /> {t("Nuevo usuario")}
        </button>
      </div>
      {noRecovery && (
        <p role="note" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          {t("Sin email ni acceso con Google: quien olvide su contraseña tendrá que pedirte que le fuerces el cambio.")}
        </p>
      )}
      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {users.map((u) => {
          // Acciones de la fila: en el escritorio, iconos en la misma línea; en el móvil, en el menú «⋯» (con los cinco
          // iconos y las insignias en la fila, el nombre y el email se quedaban sin sitio).
          const actions: { key: string; icon: typeof Pencil; label: string; title?: string; onClick: () => void; disabled?: boolean; danger?: boolean }[] = [
            ...(u.id !== meId && u.invitePending && u.active && emailAvailable ? [{ key: "resend", icon: MailPlus, label: t("Reenviar invitación a {name}", { name: u.name }), title: t("Reenviar invitación"), onClick: () => void resend(u), disabled: resending === u.id }] : []),
            { key: "edit", icon: Pencil, label: t("Editar {name}", { name: u.name }), title: t("Editar"), onClick: () => setEditing(u) },
            ...(u.id !== meId ? [{ key: "password", icon: KeyRound, label: t("Forzar cambio de contraseña de {name}", { name: u.name }), title: t("Forzar cambio de contraseña"), onClick: () => setResetting(u) }] : []),
            ...(u.id !== meId && u.twoFactor ? [{ key: "2fa", icon: ShieldOff, label: t("Restablecer la verificación en dos pasos de {name}", { name: u.name }), title: t("Restablecer la verificación en dos pasos"), onClick: () => setResetting2fa(u) }] : []),
            ...(u.id !== meId && u.googleLinked ? [{ key: "unlink", icon: Link2Off, label: t("Desvincular Google de {name}", { name: u.name }), title: t("Desvincular Google"), onClick: () => void unlink(u) }] : []),
            ...(u.googleRelinkBlocked ? [{ key: "relink", icon: Link2, label: t("Permitir Google a {name}", { name: u.name }), title: t("Permitir Google"), onClick: () => void allow(u) }] : []),
            ...(u.id !== meId ? [{ key: "delete", icon: Trash2, label: t("Borrar {name}", { name: u.name }), title: t("Borrar"), onClick: () => setDeleting(u), danger: true }] : []),
          ];
          return (
          <li key={u.id} data-user-row={u.id} className={cn("flex items-center gap-3 px-4 py-3 max-sm:flex-wrap max-sm:gap-y-1.5", !u.active && "opacity-50")}>
            <Avatar id={u.id} name={u.name} size="md" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {u.name} {u.id === meId && <span className="text-xs text-slate-500">{t("(tú)")}</span>}
              </div>
              <div className="truncate text-xs text-slate-500"><EmailSafe text={u.email} /></div>
            </div>
            {/* Insignias: en el escritorio, en la fila; en el móvil, en una segunda línea bajo el nombre. */}
            <div data-user-badges className="flex flex-wrap items-center gap-1.5 max-sm:order-last max-sm:basis-full max-sm:pl-12 sm:contents">
              <span className={cn("badge", u.role === "ADMIN" ? "bg-brand-50 text-brand-700 ring-brand-500/20" : "bg-slate-100 text-slate-600 ring-slate-500/20")}>
                {u.role === "ADMIN" ? t("Admin") : t("Miembro")}
              </span>
              {!u.active && <span className="badge bg-slate-100 text-slate-500 ring-slate-400/20">{t("Inactivo")}</span>}
              {u.invitePending ? (
                <span className="badge bg-amber-50 text-amber-700 ring-amber-500/20" title={t("Aún no ha entrado ni ha elegido su contraseña")}>{t("Invitación pendiente")}</span>
              ) : (
                u.mustChangePassword && <span className="badge bg-amber-50 text-amber-700 ring-amber-500/20" title={t("Tiene que elegir una contraseña nueva al entrar")}>{t("Contraseña pendiente")}</span>
              )}
              {u.twoFactor && <span className="badge bg-emerald-50 text-emerald-700 ring-emerald-500/20" title={t("Tiene activada la verificación en dos pasos")}>2FA</span>}
              {u.googleLinked && <span className="badge bg-slate-100 text-slate-600 ring-slate-500/20" title={t("Ha entrado con Google")}>Google</span>}
              {u.googleRelinkBlocked && <span className="badge bg-amber-50 text-amber-700 ring-amber-500/20" title={t("Google desvinculado: no se vuelve a enlazar solo")}>{t("Google bloqueado")}</span>}
            </div>
            <div className="hidden sm:contents">
              {actions.map((a) => (
                <button key={a.key} className={cn("btn-icon", a.danger && "text-red-600 dark:text-red-400")} onClick={a.onClick} disabled={a.disabled} aria-label={a.label} title={a.key === "edit" || a.key === "delete" ? undefined : a.title}>
                  <a.icon size={16} />
                </button>
              ))}
            </div>
            <Menu
              className="sm:hidden"
              label={t("Acciones de {name}", { name: u.name })}
              align="end"
              panelClassName="w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-slate-200 bg-white p-1 text-sm shadow-xl dark:border-slate-700 dark:bg-slate-900"
              trigger={({ props }) => (
                <button type="button" {...props} className="btn-icon" aria-label={t("Acciones de {name}", { name: u.name })}>
                  <MoreHorizontal size={18} />
                </button>
              )}
            >
              {actions.map((a) => (
                <MenuItem key={a.key} icon={a.icon} danger={a.danger} disabled={a.disabled} onClick={a.onClick}>
                  {a.title ?? a.label}
                </MenuItem>
              ))}
            </Menu>
          </li>
          );
        })}
      </ul>
      {creating && <UserForm emailAvailable={emailAvailable} defaultLocale={defaultLocale} onClose={() => setCreating(false)} />}
      {editing && <UserForm user={editing} isMe={editing.id === meId} onClose={() => setEditing(null)} />}
      {resetting && <ForcePasswordChange user={resetting} emailAvailable={emailAvailable} onClose={() => setResetting(null)} />}
      {resetting2fa && <ResetTwoFactor user={resetting2fa} onClose={() => setResetting2fa(null)} />}
      {deleting && <DeleteUser user={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function UserForm({ user, isMe, emailAvailable, defaultLocale = "ES", onClose }: { user?: UserRow; isMe?: boolean; emailAvailable?: boolean; defaultLocale?: UserLocale; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useActionTransition();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "MEMBER");
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState("");
  const [locale, setLocale] = useState<UserLocale>(defaultLocale);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      // Con los valores que se veían al abrir el formulario: el servidor solo aplica los cambiados y rechaza si otro
      // administrador los ha cambiado entretanto (no reactiva a quien acaban de desactivar, p. ej.).
      const res = user
        ? await updateUser(user.id, { name, email, role, active, expected: { name: user.name, email: user.email, role: user.role, active: user.active } })
        : await createUser({ name, email, role, locale, password: emailAvailable ? undefined : password });
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
            {t("Recibirá un enlace por email (válido 72 horas) para elegir su contraseña.")}
          </p>
        )}
        {!user && !emailAvailable && (
          <div>
            <label className="label" htmlFor="u-pass">{t("Contraseña inicial (mín. 10)")}</label>
            <PasswordInput id="u-pass" className="input" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required autoComplete="new-password" />
            <p className="mt-1 text-xs text-slate-500">
              {t("Sin email configurado: dásela por otro medio. Al entrar tendrá que cambiarla.")}
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
          {user?.role === "ADMIN" && role === "MEMBER" && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t("Las tarjetas que tenga asignadas en proyectos de equipo en los que no trabaja quedarán sin asignar.")}</p>
          )}
        </div>
        {!user && (
          <div>
            <label className="label" htmlFor="u-locale">{t("Idioma")}</label>
            <select id="u-locale" className="input" value={locale} onChange={(e) => setLocale(e.target.value === "EN" ? "EN" : "ES")}>
              <option value="ES">Español</option>
              <option value="EN">English</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">{emailAvailable ? t("El de su interfaz y el de la invitación. Podrá cambiarlo en «Mi perfil».") : t("El de su interfaz. Podrá cambiarlo en «Mi perfil».")}</p>
          </div>
        )}
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
  const [pending, start] = useActionTransition();
  const [link, setLink] = useState<string | null>(null);
  const run = (copyLink: boolean) =>
    start(async () => {
      const res = await forcePasswordChange(user.id, { copyLink });
      if (!res.ok) return toast(res.error, "error");
      router.refresh();
      if (res.data.link) return setLink(res.data.link);
      toast(res.data.emailed ? t("Cambio forzado: su contraseña ya no vale, se han cerrado sus sesiones y le hemos enviado un enlace por email") : t("Cambio forzado: su contraseña ya no vale y se han cerrado sus sesiones"));
      onClose();
    });
  if (link) {
    return (
      <Modal open onClose={onClose} title={t("Enlace para {name}", { name: user.name })} size="sm">
        <div className="space-y-3 text-sm">
          <p>{t("Con este enlace elegirá una contraseña nueva.")}</p>
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
        <p>
          {t("Su contraseña dejará de valer al momento y se cerrarán sus sesiones.")}{" "}
          <InfoTip topic={t("Forzar cambio de contraseña")}>{t("También se anulan los enlaces que tuviera pendientes. Tú no escribes ninguna contraseña.")}</InfoTip>
        </p>
        <p className="text-slate-500">
          {emailAvailable
            ? t("Le llegará un enlace por email (válido 30 minutos) para elegir otra.")
            : t("Sin email configurado: tendrás un enlace de un solo uso (válido 30 minutos) para pasárselo tú.")}
        </p>
        {user.googleLinked && <p className="text-slate-500">{t("Podrá seguir entrando con Google, pero antes tendrá que elegir contraseña.")}</p>}
        <p className="text-slate-500">{t("También se desconectan su calendario suscrito, Telegram, WhatsApp y Google Drive.")}</p>
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
  const [pending, start] = useActionTransition();
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
        <p>{t("Se borrarán su método y sus códigos de recuperación.")} {user.role === "ADMIN" ? t("Tendrá que configurar uno nuevo al entrar.") : t("Podrá volver a activarla en «Mi perfil».")}</p>
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
  const [pending, start] = useActionTransition();
  const [deleteProjects, setDeleteProjects] = useState(false);
  const count = user.privateProjects.length;
  return (
    <Modal open onClose={onClose} title={t("Borrar a {name}", { name: user.name })} size="sm">
      <form
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await deleteUser(user.id, count > 0 && deleteProjects ? user.privateProjects : []);
            if (!res.ok) return toast(res.error, "error");
            toast(count && deleteProjects ? t("Usuario y proyectos privados borrados") : t("Usuario borrado"));
            router.refresh();
            onClose();
          });
        }}
      >
        <p>
          {t("Se borrará su cuenta para siempre; sus tareas y comentarios se quedan, sin autor. Para quitarle solo el acceso, desactívalo.")}{" "}
          <InfoTip topic={t("Borrar usuario")}>{t("También deja de ser miembro de los proyectos privados que comparte con otras personas.")}</InfoTip>
        </p>
        {count > 0 && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200" data-testid="delete-user-private">
            <p className="flex gap-2 font-medium">
              <TriangleAlert size={18} className="shrink-0" />
              <span>
                {count === 1 ? t("Es el único miembro de 1 proyecto privado.") : t("Es el único miembro de {n} proyectos privados.", { n: count })}{" "}
                {deleteProjects
                  ? t("Se borrarán con todas sus tareas, releases y adjuntos, y no se pueden recuperar.")
                  : count === 1
                    ? t("Pasará a ser un proyecto de equipo, sin miembros: lo verán los administradores.")
                    : t("Pasarán a ser proyectos de equipo, sin miembros: los verán los administradores.")}
              </span>
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={deleteProjects} onChange={(e) => setDeleteProjects(e.target.checked)} />
              {count === 1 ? t("Borrar también este proyecto") : t("Borrar también estos proyectos")}
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn-primary bg-red-600 hover:bg-red-700" disabled={pending}>{t("Borrar usuario")}</button>
        </div>
      </form>
    </Modal>
  );
}
