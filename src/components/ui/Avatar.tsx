import { initialsOf } from "@/lib/graphemes";
import { cn } from "./cn";

// Tonos con al menos 5:1 frente a las iniciales en blanco (los -500 daban entre 2,1 y 4,5; rose-600 se quedaba en 4,5 justo).
const COLORS = ["bg-indigo-600", "bg-emerald-700", "bg-amber-700", "bg-rose-700", "bg-sky-700", "bg-violet-600", "bg-teal-700"];

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
