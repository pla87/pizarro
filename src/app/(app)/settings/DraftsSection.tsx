"use client";

import { FileX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateClearDraftsOnLogout } from "@/actions/profile";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

/** «Borrar los borradores al cerrar sesión»: el borrado lo hace el navegador al pulsar «Cerrar sesión» (AppShell). */
export function DraftsSection({ initial }: { initial: boolean }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [on, setOn] = useState(initial);
  const change = async (value: boolean) => {
    setOn(value);
    const res = await updateClearDraftsOnLogout(value);
    if (!res.ok) {
      setOn(!value);
      return toast(res.error, "error");
    }
    router.refresh();
  };
  return (
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-semibold"><FileX size={17} /> {t("Borradores")}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{t("Lo que escribes en una tarea sin guardar se conserva en este navegador. Útil en un ordenador compartido: se borra al salir.")}</p>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => void change(e.target.checked)} />
        {t("Borrar los borradores al cerrar sesión")}
      </label>
    </section>
  );
}
