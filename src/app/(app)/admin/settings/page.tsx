import { headers } from "next/headers";
import { getMaxCommentsPerTask } from "@/lib/app-settings";
import { getMailSettingsView } from "@/lib/mail-config";
import { getGoogleSettingsView } from "@/lib/google-config";
import { originFromHeaders } from "@/lib/google-config-core";
import { outboxDir } from "@/lib/mail";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { storageAdminView } from "@/lib/storage-stats";
import { getMessagingAdminView } from "@/lib/messaging";
import { getInstanceSettings } from "@/lib/instance";
import { appTimeZone, DEFAULT_TIME_ZONE } from "@/lib/format";
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
  const [maxComments, mail, google, storage, messaging, instance] = await Promise.all([
    getMaxCommentsPerTask(),
    getMailSettingsView(Boolean(outboxDir())),
    getGoogleSettingsView(origin),
    storageAdminView(),
    getMessagingAdminView(),
    getInstanceSettings(),
  ]);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [DEFAULT_TIME_ZONE];
  if (!zones.includes("UTC")) zones.push("UTC");
  // Con APP_TIMEZONE manda la variable: se muestra, pero no se puede cambiar aquí.
  const zoneLocked = Boolean(process.env.APP_TIMEZONE);
  const installation = { orgName: instance.orgName, locale: instance.locale, timeZone: zoneLocked ? appTimeZone() : instance.timeZone || appTimeZone(), zoneLocked, zones };
  return <SettingsAdmin maxComments={maxComments} mail={mail} google={google} storage={storage} messaging={messaging} installation={installation} />;
}
