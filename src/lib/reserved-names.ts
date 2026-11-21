// Nombres de persona reservados: los que imitan a Pizarro o a quien lo administra. Un nombre así en la cabecera de un
// aviso («Soporte te ha mencionado…», «Pizarro ha comentado…») o en el remitente de un comentario podría pasar por un
// mensaje del sistema. Módulo puro: lo usan las acciones de usuarios y perfil, el asistente /setup y las pruebas.
//
// Se compara el nombre entero, sin distinguir mayúsculas, tildes, espacios ni signos («Admin-istración», «PIZARRO»,
// «Soporte técnico.»): un nombre que solo CONTIENE una de estas palabras sigue valiendo (Pizarro es un apellido, y
// «Ana de Soporte» es una persona). Solo se valida al poner o cambiar un nombre: los que ya existen no se tocan.
//
// «Administrador»/«Administradora»/«Administrator»/«Admin» NO están: es el nombre por defecto del administrador que crea
// SEED_ADMIN_NAME y el que muchas instalaciones dieron a su primer administrador en /setup, y nombra a una persona real
// (quien administra), no al sistema. Sí lo están «Administración» (la sección de la app que firma sus avisos) y
// «Administrador del sistema», que no son nombres de persona.

const RESERVED = [
  // La propia aplicación y su equipo.
  "Pizarro", "Equipo de Pizarro", "Equipo Pizarro", "Soporte de Pizarro", "Soporte Pizarro", "Pizarro Soporte", "Avisos de Pizarro",
  "Pizarro Team", "Pizarro Support", "Pizarro Notifications",
  // El sistema y su administración.
  "Sistema", "System", "Administración", "Administration", "Administrador del sistema", "Administradora del sistema",
  "System Administrator", "System Admin", "Sysadmin",
  // Cuentas de servicio típicas de los mensajes automáticos.
  "Soporte", "Soporte técnico", "Support", "Technical Support", "Seguridad", "Security", "Notificaciones", "Notifications",
  "No responder", "No-reply", "Noreply",
] as const;

// Letras cirílicas y griegas que se ven igual que una latina («Pizаrro» con «а» cirílica): se pasan a la latina antes de
// comparar, para que no sirvan para saltarse la lista. Solo minúsculas: se aplica tras toLowerCase().
const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", ѕ: "s", і: "i", ї: "i", ј: "j", һ: "h", ԁ: "d", ԛ: "q", ԝ: "w",
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", μ: "u", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ζ: "z",
  // Latinas que se confunden: i sin punto, alfa latina, l pequeña de otras formas.
  ı: "i", ɑ: "a", ɩ: "i", ł: "l", ɡ: "g",
};

/** Forma de comparar: minúsculas, sin tildes ni diacríticos, letras parecidas de otros alfabetos en latín, y solo letras y cifras. */
function reservedNameKey(name: string): string {
  const lower = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return Array.from(lower, (ch) => CONFUSABLES[ch] ?? ch).join("").replace(/[^\p{L}\p{N}]/gu, "");
}

const KEYS = new Set(RESERVED.map(reservedNameKey));

/** ¿Imita este nombre al sistema? (ver RESERVED) */
export function isReservedName(name: string): boolean {
  return KEYS.has(reservedNameKey(name));
}
