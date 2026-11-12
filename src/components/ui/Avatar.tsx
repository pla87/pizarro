import { initialsOf } from "@/lib/graphemes";
import { cn } from "./cn";

const COLORS = ["bg-indigo-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-sky-500", "bg-violet-500", "bg-teal-500"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ id, name, size = "sm", title }: { id: string; name: string; size?: "sm" | "md"; title?: string }) {
  return (
    <span
      title={title ?? name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        COLORS[hash(id) % COLORS.length],
        size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs",
      )}
    >
      {/* Por caracteres visibles y solo letras o números: «Dani Ruiz 😀» → «DR». Antes salía medio emoji (un sustituto suelto),
          que el HTML del servidor convierte en «�» y la hidratación no cuadraba (error #418 de React). */}
      {initialsOf(name, "firstLast")}
    </span>
  );
}
