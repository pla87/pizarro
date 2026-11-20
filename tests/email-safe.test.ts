// Emails en el HTML del servidor a salvo de un proxy que los reescribe (Cloudflare «Email Address Obfuscation»): la
// página quedaba con otro HTML del que pintó React y daba el error de hidratación #418 (Mi perfil, Usuarios). Y el
// theme-color del tema elegido en Pizarro (ronda 56).
import assert from "node:assert/strict";
import { test } from "node:test";
import { EmailSafe, rehypeEmailSafe } from "../src/components/ui/EmailSafe";
import { themeColors } from "../src/lib/theme-color";

const EMAIL_IN_TEXT = />[^<]*[\w.+-]+@[\w-]+\.[\w.-]+/;

test("EmailSafe: entre marcas email_off, escapado y con la «@» aparte (ningún nodo de texto es un email)", () => {
  // Sin react-dom/server (las pruebas cargan React con la condición react-server): el HTML que pinta el <span>.
  const el = EmailSafe({ text: "Tu email es <ana>@example.com & ana@example.com" }) as { props: { dangerouslySetInnerHTML: { __html: string } } };
  const html = `>${el.props.dangerouslySetInnerHTML.__html}<`;
  assert.equal(html, "><!--email_off-->Tu email es &lt;ana&gt;<span>@</span>example.com &amp; ana<span>@</span>example.com<!--/email_off--><");
  assert.doesNotMatch(html, EMAIL_IN_TEXT);
});

type Node = { type: string; value?: string; tagName?: string; children?: Node[] };

test("rehypeEmailSafe: parte cada email del texto en dos nodos con la «@» en su <span>; lo demás no cambia", () => {
  const tree: Node = { type: "root", children: [{ type: "element", tagName: "p", children: [{ type: "text", value: "Escribe a ana@example.com o a b.c+d@sub.example.org, no a @alguien ni a x@y" }] }] };
  rehypeEmailSafe()(tree);
  const p = tree.children![0]!.children!;
  const text = p.map((n) => (n.type === "text" ? n.value : "<@>")).join("");
  assert.equal(text, "Escribe a ana<@>example.com o a b.c+d<@>sub.example.org, no a @alguien ni a x@y");
  assert.equal(p.filter((n) => n.type === "element").length, 2);
});

test("theme-color: con tema propio, los dos <meta> con su color; con «Sistema», cada uno el suyo", () => {
  assert.deepEqual(themeColors("dark").map((m) => m.color), ["#020617", "#020617"]);
  assert.deepEqual(themeColors("light").map((m) => m.color), ["#f8fafc", "#f8fafc"]);
  assert.deepEqual(themeColors(undefined), [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ]);
});
