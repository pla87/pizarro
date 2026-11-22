import { handleFeedbackPost } from "@/lib/feedback";
import { FEEDBACK_EMAIL } from "@/lib/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Informar de un error o enviar una sugerencia»: envía el informe por email al equipo de Pizarro (FEEDBACK_EMAIL) desde
 * el servidor de correo de la instalación. Pasa por el proxy (src/proxy.ts): el cuerpo, con la captura, no llega a su
 * tope de 2 MB (FEEDBACK_BODY_MAX_BYTES). Ver src/lib/feedback.ts.
 */
export async function POST(req: Request) {
  return handleFeedbackPost(req, { to: FEEDBACK_EMAIL });
}
