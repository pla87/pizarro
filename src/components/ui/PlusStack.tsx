/** Dos «+» superpuestos: crear varias tareas. */
export function PlusStack({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
      <path d="M9 11v9M4.5 15.5h9" />
      <path d="M16 3v8M12 7h8" />
    </svg>
  );
}
