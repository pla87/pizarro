import { headers } from "next/headers";
import { getMaxCommentsPerTask } from "@/lib/app-settings";
import { getMailSettingsView } from "@/lib/mail-config";
import { getGoogleSettingsView } from "@/lib/google-config";
import { originFromHeaders } from "@/lib/google-config-core";
import { outboxDir } from "@/lib/mail";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { storageAdminView } from "@/lib/storage-stats";
import { SettingsAdmin } from "./SettingsAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Ajustes") };
}

export default async function SettingsPage() {
  await requireAdminPage();
  // Dirección con la que entra el administrador ahora (para avisar si no coincide con APP_URL).
  const h = await headers();
  const origin = originFromHeaders({ host: h.get("host"), forwardedHost: h.get("x-forwarded-host"), forwardedProto: h.get("x-forwarded-proto") });
  return <SettingsAdmin maxComments={await getMaxCommentsPerTask()} mail={await getMailSettingsView(Boolean(outboxDir()))} google={await getGoogleSettingsView(origin)} storage={await storageAdminView()} landingAtRoot={process.env.LANDING_AT_ROOT === "1"} />;
}
