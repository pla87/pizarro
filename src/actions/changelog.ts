"use server";

import { runAction } from "@/lib/action";
import { changelogVersions } from "@/lib/changelog-page";
import { requireUser } from "@/lib/session";
import { getLocale } from "@/i18n/server";

/**
 * Las versiones desde la posición `from` hasta la más antigua: la página solo pinta las primeras (CHANGELOG_FIRST_PAGE)
 * y el resto se pide con «Ver más», al buscar o al abrir el enlace de una versión antigua.
 */
export async function getOlderVersions(from: number) {
  return runAction({ name: "changelog.getOlderVersions", args: [from] }, async () => {
    const user = await requireUser();
    const start = Number.isSafeInteger(from) && from > 0 ? from : 0;
    return changelogVersions({ en: (await getLocale()) === "en", admin: user.role === "ADMIN" }, start);
  });
}
