/** Logo de Pizarro con los colores del tema de color del usuario (el favicon sigue siendo /icon.svg). */
export function BrandMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="7" fill="var(--color-brand-600)" />
      <rect x="6" y="7" width="5.5" height="18" rx="1.5" fill="var(--color-on-brand)" />
      <rect x="13.25" y="7" width="5.5" height="12" rx="1.5" style={{ fill: "var(--color-detail-mid, var(--color-on-brand))", opacity: "var(--mark-mid-opacity)" }} />
      <rect x="20.5" y="7" width="5.5" height="7" rx="1.5" fill="var(--color-on-brand)" opacity="0.6" />
    </svg>
  );
}
