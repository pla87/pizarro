// Textos de la presentación del producto, compartidos por la página /presentacion de cada instalación
// (components/landing/Landing.tsx) y por la web estática getpizarro.com (scripts/build-site.mjs, que importa este
// fichero con Node tal cual: solo admite `import type`, sin alias «@/» ni código que dependa de Next).
// El texto en español es la clave de t(); la traducción al inglés está en src/i18n/en/.
import type { T } from "../i18n/shared";

export type PillarKey = "simple" | "once" | "data" | "small";

export function landingHero(t: T) {
  return {
    title: t("Organiza tu trabajo sin complicarte"),
    lead: t("Un tablero Kanban sencillo, que pagas una vez y funciona en tu propio servidor. Tus datos no salen de ahí."),
  };
}

export function landingPillars(t: T): { key: PillarKey; title: string; text: string }[] {
  return [
    { key: "simple", title: t("Simple"), text: t("Lo justo para organizar el trabajo: un tablero, tarjetas y columnas. Sin curva de aprendizaje y sin cientos de opciones que configurar.") },
    { key: "once", title: t("Pagas una vez y es tuyo para siempre"), text: t("Sin suscripción y sin cuota por usuario. Las actualizaciones son gratis para siempre.") },
    { key: "data", title: t("Tus datos son tuyos"), text: t("Viven en tu propio servidor, sin rastreadores, y no salen de ahí. Con copias de seguridad cifradas.") },
    { key: "small", title: t("Hecho para equipos pequeños y familias"), text: t("Para unas pocas personas que quieren ponerse de acuerdo sin montar una herramienta enorme.") },
  ];
}

export function landingIncludes(t: T): string[] {
  return [
    t("Tablero Kanban"),
    t("Notas de release generadas"),
    t("Documentación del proyecto"),
    t("Calendario"),
    t("Dictado por voz"),
    t("App en el móvil"),
    t("Verificación en dos pasos"),
    t("Español e inglés"),
  ];
}

export function landingSteps(t: T): { title: string; text: string }[] {
  return [
    { title: t("Prepara un servidor"), text: t("Un Linux con Docker.") },
    { title: t("Ejecuta un comando"), text: t("Instala todo lo necesario.") },
    { title: t("Crea tu cuenta"), text: t("Y empieza a trabajar.") },
  ];
}

export function landingFaq(t: T): { q: string; a: string }[] {
  return [
    { q: t("¿Hay que pagar por cada usuario?"), a: t("No. Invitas a quien quieras; el límite lo pone tu servidor.") },
    { q: t("¿Qué servidor necesito?"), a: t("Un Linux con Docker y 1 GB de RAM. También puedes desplegarla en Railway.") },
    { q: t("¿Cómo se actualiza?"), a: t("Repitiendo el comando de instalación, que conserva tus datos. La app avisa a los administradores cuando hay una versión nueva.") },
    { q: t("¿Puedo usarla gratis?"), a: t("Sí, para uso personal y familiar no comercial, y para la enseñanza en colegios, institutos, universidades, academias y otros centros educativos. Cualquier otro uso (empresa, autónomo, asociación, administración…) necesita la licencia.") },
  ];
}

/**
 * Preguntas sobre la licencia (web del producto): qué es uso personal, qué pasa sin pagar, el recordatorio, si se
 * bloquea algo y los centros educativos. scripts/build-site.mjs las elige por su posición: añade las nuevas al final.
 */
export function licenseFaq(t: T, priceEur: number): { q: string; a: string }[] {
  return [
    { q: t("¿Qué es uso personal?"), a: t("El de una persona en su propio servidor, para fines personales, domésticos o familiares: organizar la casa, tus aficiones o tus proyectos propios sin fines comerciales. Si lo usas en una empresa, como autónomo o profesional, o en cualquier otra organización (también asociaciones, ONG y administraciones), necesitas licencia; la enseñanza es la excepción.") },
    { q: t("¿Qué pasa si no pago?"), a: t("Pizarro funciona exactamente igual: no hay versión de prueba, ni funciones recortadas, ni fecha de caducidad. La licencia se basa en la buena voluntad. Si lo usas para trabajar, comprarla ({price} € + IVA, una sola vez) es lo que permite seguir mejorándolo.", { price: priceEur }) },
    { q: t("¿Me lo va a recordar?"), a: t("Solo a los administradores, con un aviso discreto como mucho una vez al mes, y nunca en la primera semana. Desaparece para siempre al registrar la licencia o al declarar que es uso personal o educativo en Administración → Licencia.") },
    { q: t("¿Se bloquea algo?"), a: t("No. Nada se bloquea nunca y la licencia no se comprueba por internet.") },
    { q: t("¿Y los centros educativos?"), a: t("También es gratis. Colegios, institutos, universidades, centros de formación profesional y academias, públicos o privados, con su profesorado y su alumnado, pueden usarlo sin pagar para dar clase, aprender, investigar y organizar el propio centro. Solo necesita licencia la actividad comercial ajena a la enseñanza.") },
  ];
}
