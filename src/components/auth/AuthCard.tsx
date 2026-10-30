import { BrandMark } from "@/components/ui/BrandMark";

/** Marco común de las pantallas de cuenta sin barra lateral (acceso, restablecer, confirmar…). */
export function AuthCard({ title, children, footer, wide }: { title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className={`w-full ${wide ? "max-w-xl" : "max-w-sm"}`}>
        <div className="mb-6 flex items-center justify-center gap-2">
          <BrandMark size={36} />
          <span className="text-2xl font-bold tracking-tight">Pizarro</span>
        </div>
        <div className="card p-6">
          <h1 className="mb-4 text-lg font-semibold">{title}</h1>
          {children}
        </div>
        {footer && <div className="mt-4 text-center text-xs text-slate-500">{footer}</div>}
      </div>
    </main>
  );
}
