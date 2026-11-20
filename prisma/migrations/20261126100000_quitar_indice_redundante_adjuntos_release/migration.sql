-- Lo cubre el índice único ("releaseId", "fileName"): buscar por releaseId usa su primera columna.
DROP INDEX IF EXISTS "ReleaseAttachment_releaseId_idx";
