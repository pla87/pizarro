-- Avisos por Telegram y WhatsApp: el administrador los activa en Administración → Ajustes y cada persona conecta
-- sus canales en Mi perfil → Avisos.

-- CreateEnum
CREATE TYPE "MessagingChannel" AS ENUM ('TELEGRAM', 'WHATSAPP');

-- CreateTable
CREATE TABLE "UserChannel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "MessagingChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "verifiedAt" TIMESTAMP(3),
    "consentAt" TIMESTAMP(3),
    "verifyCodeHash" TEXT,
    "verifyExpiresAt" TIMESTAMP(3),
    "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "notifyMention" BOOLEAN NOT NULL DEFAULT true,
    "notifyAssigned" BOOLEAN NOT NULL DEFAULT true,
    "notifyDue" BOOLEAN NOT NULL DEFAULT false,
    "notifyComment" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramLinkCode" (
    "hash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserChannel_userId_channel_key" ON "UserChannel"("userId", "channel");

-- CreateIndex
CREATE INDEX "UserChannel_channel_address_idx" ON "UserChannel"("channel", "address");

-- CreateIndex
CREATE INDEX "TelegramLinkCode_userId_idx" ON "TelegramLinkCode"("userId");

-- CreateIndex
CREATE INDEX "TelegramLinkCode_expiresAt_idx" ON "TelegramLinkCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "UserChannel" ADD CONSTRAINT "UserChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Resultado del envío por Telegram de cada aviso.
ALTER TABLE "Notification" ADD COLUMN "telegramSentAt" TIMESTAMP(3);

-- Quien ya tenía WhatsApp activado con su número (configuración por variables WHATSAPP_*) lo conserva: canal ya
-- confirmado, con el consentimiento que dio al activarlo y solo con menciones, que es lo que recibía.
INSERT INTO "UserChannel" ("id", "userId", "channel", "address", "verifiedAt", "consentAt", "notifyMention", "notifyAssigned", "notifyDue", "notifyComment", "updatedAt")
SELECT 'wa_' || "id", "id", 'WHATSAPP', "whatsappPhone", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true, false, false, false, CURRENT_TIMESTAMP
FROM "User"
WHERE "notifyWhatsapp" = true AND "whatsappPhone" IS NOT NULL AND "whatsappPhone" <> '';

-- Quien tenía el número guardado pero los avisos por WhatsApp desactivados no lo pierde: queda como canal sin
-- consentimiento ni verificación (no recibe nada). En Mi perfil aparece el número para activarlo con su código.
INSERT INTO "UserChannel" ("id", "userId", "channel", "address", "verifiedAt", "consentAt", "notifyMention", "notifyAssigned", "notifyDue", "notifyComment", "updatedAt")
SELECT 'wa_' || "id", "id", 'WHATSAPP', "whatsappPhone", NULL, NULL, true, false, false, false, CURRENT_TIMESTAMP
FROM "User"
WHERE "notifyWhatsapp" = false AND "whatsappPhone" IS NOT NULL AND "whatsappPhone" <> '';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "notifyWhatsapp",
DROP COLUMN "whatsappPhone";
