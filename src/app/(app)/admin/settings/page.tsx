import { getMaxCommentsPerTask } from "@/lib/app-settings";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { storageAdminView } from "@/lib/storage-stats";
import { getInstanceSettings } from "@/lib/instance";
import { APP_SHORT_NAME_KEY, getAppIcon, getAppShortName } from "@/lib/app-icon";
import { resolveAppUrl } from "@/lib/app-url";
import { appStateVersion } from "@/lib/edit-conflict";
import { appTimeZone, DEFAULT_TIME_ZONE, envTimeZone } from "@/lib/format";
import { currentTimeZoneName, timeZoneOptions } from "@/lib/time-zones";
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
  const [maxComments, storage, instance, appIcon, versions, shortName, shortNameVersion] = await Promise.all([
    getMaxCommentsPerTask(), storageAdminView(), getInstanceSettings(), getAppIcon(), settingsVersions(), getAppShortName(), appStateVersion([APP_SHORT_NAME_KEY]),
  ]);
  // Con APP_TIMEZONE (válida) manda la variable: solo se muestra la zona fija, sin la lista de ~400 zonas.
  const zoneLocked = envTimeZone() !== null;
  // Las habituales primero y todas con su nombre actual (Intl aún da Asia/Calcutta, Europe/Kiev…): ver time-zones.ts.
  const zones = zoneLocked ? [] : timeZoneOptions(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [DEFAULT_TIME_ZONE]);
  // APP_URL y de dónde sale (la variable o, sin ella, la dirección pública de Railway: lib/app-url.ts).
  const appUrl = resolveAppUrl();
  const installation = { orgName: instance.orgName, locale: instance.locale, timeZone: currentTimeZoneName(zoneLocked ? appTimeZone() : instance.timeZone || appTimeZone()), zoneLocked, zones, appUrl: appUrl.url, appUrlSource: appUrl.source };
  return <SettingsAdmin maxComments={maxComments} storage={storage} installation={installation} appIcon={appIcon} appShortName={{ value: shortName, version: shortNameVersion }} versions={versions} />;
}
