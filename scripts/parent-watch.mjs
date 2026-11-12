// `npm start`: red de seguridad para que el servidor no se quede huérfano si muere el proceso que lo lanzó.
//
// npm ejecuta el script con `sh -c "…"` (cmd.exe en Windows) y, al recibir SIGTERM, se la reenvía a ese `sh`; dash (el
// `sh` de Debian y Ubuntu) muere sin pasarla a node, y el servidor seguía escuchando en el puerto, sin dueño. El script
// de package.json no puede empezar por `exec` (cmd.exe no lo entiende y `npm start` no arrancaba en Windows), así que
// start-local.mjs vigila al proceso padre: si cambia (el sistema adopta al huérfano: pasa a ser el 1 o un «subreaper»)
// o ya no existe, lanza el apagado ordenado. Cubre también que npm muera de golpe (SIGKILL, cierre de la terminal).

/** ¿Sigue vivo el proceso `pid`? La señal 0 solo comprueba que existe (EPERM: existe, pero es de otro usuario). */
export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/**
 * Comprueba cada `intervalMs` si el padre original (`parentPid`) sigue siendo el padre y sigue vivo; la primera vez que
 * no, llama a `onOrphan` (una sola vez) y deja de vigilar. Devuelve la función que para la vigilancia. El temporizador no
 * retiene el proceso (unref).
 */
export function watchParent({ parentPid = process.ppid, currentPpid = () => process.ppid, isAlive = processAlive, onOrphan, intervalMs = 1_000 }) {
  // Sin padre conocido (ya adoptado por init al arrancar) no hay a quién vigilar.
  if (!parentPid || parentPid === 1) return () => {};
  const timer = setInterval(() => {
    if (currentPpid() === parentPid && isAlive(parentPid)) return;
    clearInterval(timer);
    onOrphan();
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Apagado ordenado sin depender de las señales del sistema (en Windows, process.kill(…, "SIGTERM") mata sin avisar): se
 * avisa a los manejadores de SIGTERM que instala el servidor (src/lib/shutdown.ts) como si hubiera llegado la señal. Sin
 * manejadores, se sale con el código de SIGTERM.
 */
export function shutdownAsIfSigterm(proc = process) {
  if (proc.listenerCount("SIGTERM") > 0) proc.emit("SIGTERM", "SIGTERM");
  else proc.exit(143);
}
