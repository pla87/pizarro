"use client";

import { Bell, BellOff } from "lucide-react";
import { useState } from "react";
import { setTaskFollowing } from "@/actions/tasks";
import { useT } from "@/i18n/client";
import { useToast } from "../ui/Toast";
import { useBoard } from "./context";

/** «Seguir / Dejar de seguir» la tarea: quien la sigue recibe avisos de sus comentarios y cambios. */
export function FollowToggle({ taskId, following }: { taskId: string; following: boolean | undefined }) {
  const t = useT();
  const toast = useToast();
  const board = useBoard();
  const [value, setValue] = useState(following);
  // El valor llega con la tarea cargada: cuando cambia desde fuera, se muestra el nuevo.
  const [shown, setShown] = useState(following);
  if (shown !== following) {
    setShown(following);
    setValue(following);
  }
  if (value === undefined) return null;

  const toggle = async () => {
    const next = !value;
    setValue(next);
    const res = await board.track(setTaskFollowing(taskId, next));
    if (!res.ok) {
      setValue(!next);
      toast(res.error, "error");
    }
  };

  return (
    <div>
      <button
        type="button"
        className="btn-secondary w-full justify-center py-1.5"
        onClick={toggle}
        aria-pressed={value}
        title={value ? t("Recibes avisos de los comentarios y cambios de esta tarea") : t("No recibes avisos de esta tarea (salvo si te mencionan)")}
      >
        {value ? <><BellOff size={15} /> {t("Dejar de seguir")}</> : <><Bell size={15} /> {t("Seguir")}</>}
      </button>
    </div>
  );
}
