import { AuthCard } from "@/components/auth/AuthCard";
import { getPublicContactEmail } from "@/lib/google-config";
import { getT } from "@/i18n/server";

/** Texto genérico de privacidad o condiciones de una instalación de Pizarro (páginas públicas /privacy y /terms). */
export async function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const t = await getT();
  const email = await getPublicContactEmail();
  const contact = email || t("el administrador de esta instalación");
  const sections =
    kind === "privacy"
      ? [
          [t("Quién trata tus datos"), t("Esta instalación de Pizarro la gestiona su administrador, no sus desarrolladores. Para cualquier duda sobre tus datos, contacta con {contact}.", { contact })],
          [t("Qué datos se guardan"), t("Tu cuenta (nombre, email y contraseña cifrada), las tareas, comentarios y archivos que tú o tu equipo añadís, y un registro de actividad para la seguridad y el soporte.")],
          [t("Acceso con Google"), t("Si entras con Google, Pizarro solo lee tu nombre, tu email y tu perfil básico para reconocer tu cuenta. Si conectas Google Docs o Sheets, el permiso de Drive se limita a los archivos que crea la propia aplicación; Pizarro no ve el resto de tu Drive.")],
          [t("Uso y venta de datos"), t("Tus datos no se venden ni se ceden a terceros ni se usan para publicidad. Solo se usan para que la aplicación funcione para ti y tu equipo.")],
          [t("Tus derechos"), t("Contactando con {contact}, puedes pedir que te muestren, corrijan o eliminen tus datos.", { contact })],
        ]
      : [
          [t("Uso del servicio"), t("Pizarro es una herramienta de trabajo en equipo que opera su administrador. Solo pueden usarla las personas a las que el administrador ha dado de alta.")],
          [t("Tu responsabilidad"), t("Guarda tus credenciales con cuidado y no subas contenido ilegal ni de terceros sin permiso. El administrador puede suspender cuentas que incumplan estas condiciones.")],
          [t("Disponibilidad"), t("El servicio se ofrece tal cual, sin garantía de disponibilidad continua. El administrador hace copias de seguridad, pero conviene conservar una copia de lo importante.")],
          [t("Datos personales"), t("El tratamiento de tus datos se describe en la política de privacidad de esta instalación.")],
          [t("Contacto"), t("Para cualquier duda, contacta con {contact}.", { contact })],
        ];
  return (
    <AuthCard wide title={kind === "privacy" ? t("Política de privacidad") : t("Condiciones del servicio")}>
      <div className="space-y-4 text-sm" data-testid={`legal-${kind}`}>
        {sections.map(([h, body]) => (
          <section key={h}>
            <h2 className="font-semibold">{h}</h2>
            <p className="mt-1 text-slate-600 dark:text-slate-300">{body}</p>
          </section>
        ))}
        <p className="pt-2 text-xs"><a className="underline" href="/login">{t("Volver al acceso")}</a></p>
      </div>
    </AuthCard>
  );
}
