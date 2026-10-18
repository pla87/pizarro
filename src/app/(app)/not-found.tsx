import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-semibold">No encontrado</p>
      <p className="text-sm text-slate-500">La página no existe o no tienes acceso.</p>
      <Link href="/" className="btn-secondary">Volver al inicio</Link>
    </div>
  );
}
