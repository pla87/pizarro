import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { DEFAULT_TIME_ZONE, envTimeZone } from "@/lib/format";
import { emailEnabled } from "@/lib/mail";
import { isSetupPending } from "@/lib/setup";
import { setupCodeSource } from "@/lib/setup-core";
import { currentTimeZoneName, timeZoneOptions } from "@/lib/time-zones";
import { SetupWizard } from "./SetupWizard";

export const metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

/** Asistente de primer arranque: solo existe mientras no haya usuarios (después, 404). */
export default async function SetupPage() {
  if (!(await isSetupPending(db))) notFound();
  // Las habituales primero y todas con su nombre actual (Intl aún da Asia/Calcutta, Europe/Kiev…): ver time-zones.ts.
  const zones = timeZoneOptions(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [DEFAULT_TIME_ZONE]);
  // Una APP_TIMEZONE mal escrita no fija la zona (se ignora): si no, el asistente enviaría una zona no válida.
  const envTz = envTimeZone();
  return <SetupWizard zones={zones} defaultZone={currentTimeZoneName(envTz ?? DEFAULT_TIME_ZONE)} zoneLocked={Boolean(envTz)} smtp={emailEnabled()} codeSource={setupCodeSource()} />;
}
