// Iniciales de avatares y de proyectos (calendario): por caracteres visibles, sin partir emojis ni coger puntuación.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Avatar } from "../src/components/ui/Avatar";
import { initialsOf } from "../src/lib/graphemes";

/** Texto que pinta el avatar (el elemento de React que devuelve el componente). */
const avatarText = (name: string) => (Avatar({ id: "u1", name }) as { props: { children: unknown } }).props.children;

test("avatar: «Dani Ruiz 😀» → «DR», sin medio emoji (el sustituto suelto rompía la hidratación, React #418)", () => {
  assert.equal(avatarText("Dani Ruiz 😀"), "DR");
  assert.equal(avatarText("😀 Dani"), "D");
  assert.equal(avatarText("ana maría lópez"), "AL");
  assert.equal(avatarText("Íñigo"), "Í");
  for (const name of ["Dani Ruiz 😀", "😀", "👨‍👩‍👧‍👦 Familia", "🇪🇸", "éva ruiz"]) {
    const text = avatarText(name);
    assert.equal(typeof text, "string");
    assert.ok((text as string).isWellFormed(), `${name} → sin sustitutos sueltos`);
  }
});

test("avatar: sin letras ni números, el primer carácter visible entero; vacío, «?»", () => {
  assert.equal(avatarText("😀"), "😀");
  assert.equal(avatarText("👨‍👩‍👧‍👦"), "👨‍👩‍👧‍👦");
  assert.equal(avatarText("🇪🇸 🎉"), "🇪🇸");
  assert.equal(avatarText("   "), "?");
  assert.equal(avatarText(""), "?");
});

test("avatar: la letra con tilde combinada va entera", () => {
  assert.equal(avatarText("éva ruiz"), "ÉR");
});

test("calendario: iniciales del proyecto solo con letras y números («Trello «raro» 🎉» → «TR»)", () => {
  assert.equal(initialsOf("Trello «raro» 🎉", "firstTwo"), "TR");
  assert.equal(initialsOf("«Web» - 2026 nueva", "firstTwo"), "W2");
  assert.equal(initialsOf("¿Qué? ¡Bien!", "firstTwo"), "QB");
  assert.equal(initialsOf("🎉 Fiesta", "firstTwo"), "F");
  assert.equal(initialsOf("🎉", "firstTwo"), "🎉");
  assert.equal(initialsOf("东京 项目", "firstTwo"), "东项");
});
