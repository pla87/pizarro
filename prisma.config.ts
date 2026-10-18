import { existsSync } from "node:fs";
import { defineConfig, env } from "prisma/config";

// En local se carga .env; en Docker/Railway las variables ya vienen del entorno.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node --import tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
