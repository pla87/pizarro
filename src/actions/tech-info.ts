"use server";

import { runAction } from "@/lib/action";
import { requireAdmin } from "@/lib/session";
import { collectTechInfo } from "@/lib/tech-info";

/** «Copiar información técnica» (Administración → Ajustes): solo administradores; no lleva datos personales ni valores. */
export async function getTechInfo() {
  return runAction({ name: "admin.techInfo" }, async () => {
    await requireAdmin();
    return collectTechInfo();
  });
}
