import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReleaseMarkdown, formatReleaseLine, releaseFileName } from "../src/lib/release";

test("agrupa por tipo con cabecera y pie", () => {
  const md = buildReleaseMarkdown({
    header: "CABECERA",
    footer: "PIE",
    title: "Release X",
    tasks: [
      { title: "Fix 1", type: "FIX" },
      { title: "Feat 1", type: "FEATURE", linkUrl: "https://example.com/pr/1" },
      { title: "Refactor 1", type: "REFACTOR" },
      { title: "Hot 1", type: "HOTFIX" },
      { title: "Chore 1", type: "CHORE" },
    ],
  });
  const lines = md.trim().split("\n");
  assert.equal(lines[0], "CABECERA");
  assert.equal(lines.at(-1), "PIE");
  const idx = (s: string) => lines.indexOf(s);
  assert.ok(idx("### Features") < idx("### Fixes") && idx("### Fixes") < idx("### Chores / Infra"));
  // Los hotfix van primero dentro de Fixes.
  assert.ok(idx("- **[HOTFIX]** Hot 1") < idx("- Fix 1"));
  assert.ok(lines.includes("- Feat 1 ([enlace](<https://example.com/pr/1>))"));
  assert.ok(lines.includes("- *(refactor)* Refactor 1"));
});

test("omite secciones vacías y plantillas vacías", () => {
  const md = buildReleaseMarkdown({ header: "  ", footer: "", title: "R", tasks: [{ title: "Solo fix", type: "FIX" }] });
  assert.equal(md, "## R\n\n### Fixes\n- Solo fix\n");
});

test("escapa corchetes y normaliza espacios del título", () => {
  assert.equal(formatReleaseLine({ title: "Arreglo [x]\n  en  modal", type: "FIX" }), "- Arreglo \\[x\\] en modal");
});

test("nombre de fichero con fecha local", () => {
  assert.equal(releaseFileName(new Date(2026, 0, 5, 23, 30), "md"), "release-2026-01-05.md");
  assert.equal(releaseFileName(new Date(2026, 11, 31), "txt"), "release-2026-12-31.txt");
});
