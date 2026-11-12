import assert from "node:assert/strict";
import { test } from "node:test";
import { collapseSpaces, sameName } from "../src/lib/name-spaces";
import { name } from "../src/lib/validation";

test("los nombres se guardan con un solo espacio normal entre palabras", () => {
  assert.equal(collapseSpaces("  Proyecto   nuevo  "), "Proyecto nuevo");
  assert.equal(collapseSpaces("Proyecto nuevo"), "Proyecto nuevo"); // espacio duro
  assert.equal(collapseSpaces("Proyecto  \t nuevo"), "Proyecto nuevo");
  // El validador de nombres (proyectos, columnas, etiquetas, tipos…) aplica lo mismo, también con un máximo propio.
  assert.equal(name.parse("  Mi  proyecto web "), "Mi proyecto web");
  assert.equal(name.max(40).parse("Etiqueta   urgente"), "Etiqueta urgente");
  assert.throws(() => name.parse("   "), /obligatorio/);
});

test("al confirmar un borrado se compara sin las diferencias de espacios", () => {
  // Un nombre guardado antes con dos espacios o uno duro se ve con uno: escribir lo que se ve basta.
  assert.equal(sameName("Proyecto  doble", "Proyecto doble"), true);
  assert.equal(sameName("Proyecto duro", "Proyecto duro"), true);
  assert.equal(sameName("Proyecto", "Proyecto "), true);
  assert.equal(sameName("Proyecto", "proyecto"), false);
  assert.equal(sameName("Proyecto A", "Proyecto B"), false);
});
