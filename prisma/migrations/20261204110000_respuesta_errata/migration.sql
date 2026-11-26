BEGIN;

-- Errata de serie del tipo «Respuesta» («de mi» → «de mí»): solo si nadie ha cambiado su texto.
UPDATE "TaskKind"
SET "descriptionTemplate" = 'Respondo a las preguntas y lo que necesitas de mí:'
WHERE "projectId" IS NULL
  AND "descriptionTemplate" = 'Respondo a las preguntas y lo que necesitas de mi:';

COMMIT;
