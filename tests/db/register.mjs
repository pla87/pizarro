// Se carga con --import en `npm run test:db`: sustituye next/headers, next/cache y next/server por
// stubs de pruebas (ver stubs/) para poder llamar a las Server Actions fuera de Next.
// Solo afecta al proceso de los tests: no hay ninguna rama de pruebas en el código de producción.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
