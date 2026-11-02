"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/session";
import { dismissUpdateNotice } from "@/lib/update-check";
import { parseSemver } from "@/lib/update-check-core";

/** Oculta el aviso de «versión nueva» de esa versión para todos los administradores. */
export async function dismissUpdate(version: string) {
  return runAction({ name: "updateNotice.dismiss" }, async () => {
    await requireAdmin();
    const p = parseSemver(version);
    if (!p) throw new AppError("Versión no válida.");
    await dismissUpdateNotice(p.join("."));
    revalidatePath("/admin", "layout");
  });
}
