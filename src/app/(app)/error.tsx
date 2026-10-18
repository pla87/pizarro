"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-semibold">Algo ha fallado</p>
      <p className="text-sm text-slate-500">Inténtalo de nuevo. Si persiste, revisa los logs del servidor.</p>
      <button onClick={reset} className="btn-primary">Reintentar</button>
    </div>
  );
}
