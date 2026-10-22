import { splitMentions } from "@/lib/mentions";

/** Texto en una línea (p. ej. el título de una tarea) con las menciones @[Nombre](user:ID) pintadas como etiquetas. */
export function MentionText({ text }: { text: string }) {
  const parts = splitMentions(text);
  if (parts.length === 1 && typeof parts[0] === "string") return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <span key={i} className="rounded bg-brand-50 px-1 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-100">@{p.name}</span>
        ),
      )}
    </>
  );
}
