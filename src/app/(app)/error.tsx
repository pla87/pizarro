"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" />;
}
