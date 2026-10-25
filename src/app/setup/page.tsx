import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { DEFAULT_TIME_ZONE } from "@/lib/format";
import { emailEnabled } from "@/lib/mail";
import { isSetupPending } from "@/lib/setup";
import { SetupWizard } from "./SetupWizard";

export const metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

/** Asistente de primer arranque: solo existe mientras no haya usuarios (después, 404). */
export default async function SetupPage() {
  if (!(await isSetupPending(db))) notFound();
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [DEFAULT_TIME_ZONE];
  if (!zones.includes("UTC")) zones.push("UTC");
  const envTz = process.env.APP_TIMEZONE || null;
  return <SetupWizard zones={zones} defaultZone={envTz ?? DEFAULT_TIME_ZONE} zoneLocked={Boolean(envTz)} smtp={emailEnabled()} />;
}
