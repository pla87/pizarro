// Conexión SMTP reutilizable (src/lib/mail.ts): una sola conexión para varios emails, otra si el servidor la cierra y
// cierre al cambiar la configuración o al apagar. Contra un servidor SMTP mínimo en un puerto local.
import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import { after, before, describe, test } from "node:test";

// mail.ts carga el registro (y este, el cliente de la base, que no llega a conectar).
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

interface FakeSmtp {
  server: Server;
  port: number;
  /** Conexiones abiertas desde el arranque. */
  connections: number;
  /** Emails recibidos (asunto). */
  subjects: string[];
  /** Cabeceras de cada email recibido. */
  heads: string[];
  sockets: Set<Socket>;
}

/** Servidor SMTP de pruebas: saluda, acepta cualquier remitente y destinatario y guarda el asunto de cada email. */
async function fakeSmtp(): Promise<FakeSmtp> {
  const state = { connections: 0, subjects: [] as string[], heads: [] as string[], sockets: new Set<Socket>() } as FakeSmtp;
  state.server = createServer((socket) => {
    state.connections++;
    state.sockets.add(socket);
    socket.on("close", () => state.sockets.delete(socket));
    socket.on("error", () => {});
    let buf = "";
    let inData = false;
    socket.write("220 localhost ESMTP\r\n");
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          const body = buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          state.subjects.push(/^Subject: (.*)$/m.exec(body)?.[1] ?? "");
          state.heads.push(body.split("\r\n\r\n")[0] ?? "");
          socket.write("250 OK\r\n");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") socket.write("250-localhost\r\n250 8BITMIME\r\n");
        else if (cmd === "HELO" || cmd === "MAIL" || cmd === "RCPT" || cmd === "RSET" || cmd === "NOOP") socket.write("250 OK\r\n");
        else if (cmd === "DATA") {
          inData = true;
          socket.write("354 Go\r\n");
        } else if (cmd === "QUIT") socket.end("221 Bye\r\n");
        else socket.write("502 ?\r\n");
      }
    });
  });
  await new Promise<void>((r) => state.server.listen(0, "127.0.0.1", () => r()));
  state.port = (state.server.address() as { port: number }).port;
  return state;
}

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM", "SMTP_USER", "SMTP_PASS", "SMTP_SECURE", "MAIL_OUTBOX_DIR"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let smtp: FakeSmtp;
let other: FakeSmtp;

const useServer = (s: FakeSmtp) => {
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = String(s.port);
  process.env.SMTP_FROM = "Pizarro <pizarro@example.com>";
};
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("tiempo agotado");
    await new Promise((r) => setTimeout(r, 10));
  }
};

before(async () => {
  smtp = await fakeSmtp();
  other = await fakeSmtp();
  for (const k of ENV_KEYS) delete process.env[k];
  useServer(smtp);
});

after(async () => {
  const { closeMailTransport } = await import("../src/lib/mail");
  closeMailTransport();
  for (const s of [smtp, other]) {
    for (const socket of s.sockets) socket.destroy();
    await new Promise<void>((r) => s.server.close(() => r()));
  }
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("transporte SMTP", () => {
  test("varios emails, también a la vez, por una sola conexión", async () => {
    const { sendMail } = await import("../src/lib/mail");
    await sendMail({ to: "a@example.com", subject: "uno", text: "1" });
    await Promise.all([2, 3, 4].map((n) => sendMail({ to: "a@example.com", subject: `n${n}`, text: String(n) })));
    assert.deepEqual(smtp.subjects.sort(), ["n2", "n3", "n4", "uno"]);
    assert.equal(smtp.connections, 1);
  });

  test("si el servidor cierra la conexión, el siguiente email abre otra y sale", async () => {
    const { sendMail } = await import("../src/lib/mail");
    const before = smtp.connections;
    for (const socket of smtp.sockets) socket.destroy();
    await waitFor(() => smtp.sockets.size === 0);
    await new Promise((r) => setTimeout(r, 50));
    await sendMail({ to: "a@example.com", subject: "tras el corte", text: "x" });
    assert.ok(smtp.subjects.includes("tras el corte"));
    assert.equal(smtp.connections, before + 1);
  });

  test("al cambiar la configuración se cierra la conexión anterior (después de sus envíos en curso)", async () => {
    const { sendMail } = await import("../src/lib/mail");
    assert.ok(smtp.sockets.size > 0, "la conexión anterior sigue abierta para reutilizarla");
    const pending = sendMail({ to: "a@example.com", subject: "antes del cambio", text: "x" });
    useServer(other);
    await sendMail({ to: "a@example.com", subject: "con la nueva", text: "y" });
    await pending;
    assert.ok(smtp.subjects.includes("antes del cambio"));
    assert.deepEqual(other.subjects, ["con la nueva"]);
    await waitFor(() => smtp.sockets.size === 0);
  });

  test("al apagar se cierra la conexión; un envío posterior abre otra", async () => {
    const { closeMailTransport, sendMail } = await import("../src/lib/mail");
    assert.equal(other.sockets.size, 1);
    closeMailTransport();
    await waitFor(() => other.sockets.size === 0);
    await sendMail({ to: "a@example.com", subject: "después", text: "z" });
    assert.equal(other.connections, 2);
  });
});

describe("cabeceras y remitente", () => {
  test("cada email lleva Auto-Submitted y X-Auto-Response-Suppress (sin respuestas automáticas)", async () => {
    const { sendMail } = await import("../src/lib/mail");
    useServer(smtp);
    await sendMail({ to: "a@example.com", subject: "cabeceras", text: "x" });
    const head = smtp.heads.at(-1)!;
    assert.match(head, /^Auto-Submitted: auto-generated$/m);
    assert.match(head, /^X-Auto-Response-Suppress: All$/m);
    assert.match(head, /^From: Pizarro <pizarro@example\.com>$/m);
  });

  test("un remitente sin nombre sale con el de la organización o, sin ella, «Pizarro»", async () => {
    const { sendMail } = await import("../src/lib/mail");
    useServer(smtp);
    // Sin base de datos (esta prueba no la tiene) no hay nombre de organización: «Pizarro».
    process.env.SMTP_FROM = "avisos@example.com";
    await sendMail({ to: "a@example.com", subject: "sin nombre", text: "x" });
    assert.match(smtp.heads.at(-1)!, /^From: Pizarro <avisos@example\.com>$/m);
  });
});
