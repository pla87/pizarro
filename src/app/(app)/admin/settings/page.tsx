import { getMaxCommentsPerTask } from "@/lib/app-settings";
import { getMailSettingsView } from "@/lib/mail-config";
import { outboxDir } from "@/lib/mail";
import { requireAdminPage } from "@/lib/session";
import { getT } from "@/i18n/server";
import { SettingsAdmin } from "./SettingsAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Ajustes") };
}

export default async function SettingsPage() {
  await requireAdminPage();
  return <SettingsAdmin maxComments={await getMaxCommentsPerTask()} mail={await getMailSettingsView(Boolean(outboxDir()))} />;
}
