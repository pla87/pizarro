import { getMaxCommentsPerTask } from "@/lib/app-settings";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { storageAdminView } from "@/lib/storage-stats";
import { getInstanceSettings } from "@/lib/instance";
import { getAppIcon } from "@/lib/app-icon";
import { appTimeZone, DEFAULT_TIME_ZONE, envTimeZone } from "@/lib/format";
import { settingsVersions } from "@/lib/settings-versions";
import { SettingsAdmin } from "./SettingsAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Ajustes") };
}

/** Administración → Ajustes: la instalación (nombre, idioma, zona, icono), almacenamiento, parámetros generales y
 * diagnóstico. Email, Google y Telegram/WhatsApp están en Integraciones (/admin/integrations). */
export default async function SettingsPage() {
  await requireAdminPage();
  const [maxComments, storage, instance, appIcon, versions] = await Promise.all([getMaxCommentsPerTask(), storageAdminView(), getInstanceSettings(), getAppIcon(), settingsVersions()]);
  // Con APP_TIMEZONE (válida) manda la variable: solo se muestra la zona fija, sin la lista de ~400 zonas.
  const zoneLocked = envTimeZone() !== null;
  const zones = zoneLocked ? [] : typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [DEFAULT_TIME_ZONE];
  if (!zoneLocked && !zones.includes("UTC")) zones.push("UTC");
  const installation = { orgName: instance.orgName, locale: instance.locale, timeZone: zoneLocked ? appTimeZone() : instance.timeZone || appTimeZone(), zoneLocked, zones };
  return <SettingsAdmin maxComments={maxComments} storage={storage} installation={installation} appIcon={appIcon} versions={versions} />;
}
