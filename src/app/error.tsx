"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

/** Errores de las pantallas sin sesión (acceso, verificación en dos pasos, restablecer…): sin esto caerían en global-error. */
export default function RootErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center" />;
}
