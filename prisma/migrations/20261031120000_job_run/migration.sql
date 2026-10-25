-- Última ejecución de cada tarea de mantenimiento (persistente y compartida entre procesos).
CREATE TABLE "JobRun" (
    "name" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastOk" BOOLEAN,
    "lastError" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("name")
);
