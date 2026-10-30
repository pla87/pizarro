import { LegalPage } from "@/components/auth/LegalPage";
import { getT } from "@/i18n/server";

// Página pública (sin sesión): la enlazan la pantalla de acceso y la pantalla de consentimiento de Google.
export async function generateMetadata() {
  const t = await getT();
  return { title: t("Condiciones del servicio") };
}

export default function Page() {
  return <LegalPage kind="terms" />;
}
