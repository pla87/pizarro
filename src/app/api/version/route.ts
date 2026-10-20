export const dynamic = "force-dynamic";

/** Compilación que está sirviendo el servidor (la compara el navegador para detectar despliegues). */
export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
