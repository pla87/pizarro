import { getPublicContactEmail } from "@/lib/google-config";
import { getLicense } from "@/lib/license-registry";
import { buyHref } from "@/lib/product";
import { requireAdminPage } from "@/lib/session";
import { getLocale, getT } from "@/i18n/server";
import { LicenseAdmin } from "./LicenseAdmin";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Licencia") };
}

export default async function LicensePage() {
  await requireAdminPage();
  const [license, contact, locale] = await Promise.all([getLicense(), getPublicContactEmail().catch(() => ""), getLocale()]);
  return <LicenseAdmin license={license} buyHref={buyHref(contact, locale)} />;
}
