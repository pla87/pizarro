// Copia los recursos estáticos dentro de .next/standalone para `npm start`
// (en Docker se copian en el propio Dockerfile).
import { cpSync, existsSync } from "node:fs";

cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
if (existsSync("public")) cpSync("public", ".next/standalone/public", { recursive: true });
