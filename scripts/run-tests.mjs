// `npm test`: las pruebas unitarias (tests/*.test.ts) con el mismo Node, sin --max-old-space-size en NODE_OPTIONS.
// Algunos entornos (la nube de los agentes, CI ajenos) traen NODE_OPTIONS con ese flag, y con él el resourceLimits del
// worker de PDF no se aplica (ver docs/handoff/GUARDAS.md, «PDF y descargas»): las pruebas del techo de memoria del PDF
// fallaban. Se quita solo ese flag; el resto de NODE_OPTIONS (p. ej. --use-openssl-ca) se conserva. Sin shell, así que
// funciona igual en Windows; el patrón tests/*.test.ts lo expande el propio `node --test`. Lo que se pase detrás
// (`npm test -- --test-name-pattern=pdf`) va a node --test.
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Opciones fijas de las pruebas unitarias (las de siempre del script `test` de package.json). */
export const TEST_ARGS = ["--conditions=react-server", "--import", "tsx", "--test", "--test-timeout=120000", "tests/*.test.ts"];

/**
 * NODE_OPTIONS sin --max-old-space-size (también escrito con «_», con el valor tras «=» o tras un espacio); undefined si
 * no queda nada. Lo demás, en su orden.
 */
export function withoutHeapFlag(nodeOptions) {
  if (!nodeOptions) return nodeOptions;
  const parts = nodeOptions.trim().split(/\s+/).filter(Boolean);
  const kept = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (/^--max[-_]old[-_]space[-_]size=/.test(p)) continue;
    if (/^--max[-_]old[-_]space[-_]size$/.test(p)) {
      if (/^\d+$/.test(parts[i + 1] ?? "")) i++;
      continue;
    }
    kept.push(p);
  }
  return kept.length ? kept.join(" ") : undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const env = { ...process.env };
  const options = withoutHeapFlag(env.NODE_OPTIONS);
  if (options === undefined) delete env.NODE_OPTIONS;
  else env.NODE_OPTIONS = options;
  if (options !== process.env.NODE_OPTIONS && process.env.NODE_OPTIONS) console.error("npm test: --max-old-space-size quitado de NODE_OPTIONS (anula el techo de memoria del worker de PDF).");
  const child = spawn(process.execPath, [...TEST_ARGS, ...process.argv.slice(2)], { stdio: "inherit", env });
  // Ctrl+C llega también al hijo (mismo grupo de procesos): aquí solo se espera a que termine. Un SIGTERM enviado solo a
  // este proceso se le pasa al hijo.
  const onInt = () => {};
  const onTerm = () => child.kill("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  child.on("exit", (code, signal) => {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}
