"use client";

import { PasswordInput } from "@/components/ui/PasswordInput";
import { KeyRound, Pencil, Trash2, TriangleAlert, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createUser, deleteUser, resetUserPassword, updateUser } from "@/actions/users";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/components/ui/cn";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

type Role = "ADMIN" | "MEMBER";
interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  privateProjects: number;
}

export function UsersAdmin({ users, meId, maxUsers }: { users: UserRow[]; meId: string; maxUsers: number }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const activeCount = users.filter((u) => u.active).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold">Usuarios</h2>
          <p className="text-sm text-slate-500">{activeCount} de {maxUsers} usuarios activos. No hay registro público: solo un administrador puede dar de alta usuarios.</p>
        </div>
        <button className="btn-primary ml-auto" onClick={() => setCreating(true)} disabled={activeCount >= maxUsers}>
          <UserPlus size={16} /> Nuevo usuario
        </button>
      </div>
      <ul className="card divide-y divide-slate-200 dark:divide-slate-800">
        {users.map((u) => (
          <li key={u.id} className={cn("flex items-center gap-3 px-4 py-3", !u.active && "opacity-50")}>
            <Avatar id={u.id} name={u.name} size="md" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {u.name} {u.id === meId && <span className="text-xs text-slate-500">(tú)</span>}
              </div>
              <div className="truncate text-xs text-slate-500">{u.email}</div>
            </div>
            <span className={cn("badge", u.role === "ADMIN" ? "bg-brand-50 text-brand-700 ring-brand-500/20" : "bg-slate-100 text-slate-600 ring-slate-500/20")}>
              {u.role === "ADMIN" ? "Admin" : "Miembro"}
            </span>
            {!u.active && <span className="badge bg-slate-100 text-slate-500 ring-slate-400/20">Inactivo</span>}
            <button className="btn-icon" onClick={() => setEditing(u)} aria-label={`Editar ${u.name}`}><Pencil size={16} /></button>
            <button className="btn-icon" onClick={() => setResetting(u)} aria-label={`Restablecer contraseña de ${u.name}`}><KeyRound size={16} /></button>
            {u.id !== meId && (
              <button className="btn-icon text-red-600 dark:text-red-400" onClick={() => setDeleting(u)} aria-label={`Borrar ${u.name}`}><Trash2 size={16} /></button>
            )}
          </li>
        ))}
      </ul>
      {creating && <UserForm onClose={() => setCreating(false)} />}
      {editing && <UserForm user={editing} isMe={editing.id === meId} onClose={() => setEditing(null)} />}
      {resetting && <ResetPassword user={resetting} onClose={() => setResetting(null)} />}
      {deleting && <DeleteUser user={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function UserForm({ user, isMe, onClose }: { user?: UserRow; isMe?: boolean; onClose: () => void }) {
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
      const res = user ? await updateUser(user.id, { name, email, role, active }) : await createUser({ name, email, role, password });
      if (!res.ok) return toast(res.error, "error");
      toast(user ? "Usuario actualizado" : "Usuario creado");
      router.refresh();
      onClose();
    });
  };

  return (
    <Modal open onClose={onClose} title={user ? "Editar usuario" : "Nuevo usuario"} size="sm">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="u-name">Nombre</label>
          <input id="u-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required data-autofocus />
        </div>
        <div>
          <label className="label" htmlFor="u-email">Email</label>
          <input id="u-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} required autoComplete="off" />
        </div>
        {!user && (
          <div>
            <label className="label" htmlFor="u-pass">Contraseña inicial (mín. 10)</label>
            <PasswordInput id="u-pass" className="input" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required autoComplete="new-password" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="u-role">Rol</label>
          <select id="u-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isMe}>
            <option value="MEMBER">Miembro</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </div>
        {user && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={isMe} />
            Usuario activo (si lo desactivas, se cierran sus sesiones)
          </label>
        )}
        {user && user.privateProjects > 0 && (!active || role !== "ADMIN") && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {user.privateProjects === 1 ? "Su proyecto privado quedará bloqueado" : `Sus ${user.privateProjects} proyectos privados quedarán bloqueados`} (nadie podrá verlos) hasta que vuelva a ser administrador activo.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={pending}>{user ? "Guardar" : "Crear usuario"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPassword({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");
  return (
    <Modal open onClose={onClose} title={`Restablecer contraseña de ${user.name}`} size="sm">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await resetUserPassword(user.id, password);
            if (!res.ok) return toast(res.error, "error");
            toast("Contraseña restablecida; se han cerrado sus sesiones");
            onClose();
          });
        }}
      >
        <div>
          <label className="label" htmlFor="r-pass">Nueva contraseña (mín. 10)</label>
          <PasswordInput id="r-pass" className="input" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required autoComplete="new-password" data-autofocus />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={pending}>Restablecer</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteUser({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const count = user.privateProjects;
  return (
    <Modal open onClose={onClose} title={`Borrar a ${user.name}`} size="sm">
      <form
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await deleteUser(user.id, count > 0 && confirmed);
            if (!res.ok) return toast(res.error, "error");
            toast(count ? "Usuario y proyectos privados borrados" : "Usuario borrado");
            router.refresh();
            onClose();
          });
        }}
      >
        <p>Se borrará su cuenta para siempre. En los proyectos compartidos sus tareas y comentarios se conservan, sin autor. Si solo quieres quitarle el acceso, desactívalo.</p>
        {count > 0 && (
          <div className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            <p className="flex gap-2 font-medium">
              <TriangleAlert size={18} className="shrink-0" />
              {count === 1 ? "Tiene 1 proyecto privado." : `Tiene ${count} proyectos privados.`} Se borrarán con todas sus tareas, releases y adjuntos, y no se pueden recuperar.
            </p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              Entiendo que se borran {count === 1 ? "su proyecto privado" : "sus proyectos privados"}
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary bg-red-600 hover:bg-red-700" disabled={pending || (count > 0 && !confirmed)}>Borrar usuario</button>
        </div>
      </form>
    </Modal>
  );
}
