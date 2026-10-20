"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/client";
import { cn } from "./cn";

/** Campo de contraseña con botón para mostrarla u ocultarla. */
export function PasswordInput({ className, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={cn(className, "pr-10")} />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("Ocultar contraseña") : t("Mostrar contraseña")}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}
