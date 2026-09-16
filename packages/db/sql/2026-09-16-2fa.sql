-- Migration 2FA — 2026-09-16
--
-- À jouer AVANT (ou au moment de) déployer le code de la double
-- authentification : tant que ces colonnes n'existent pas, toute lecture d'un
-- utilisateur par Prisma échoue (la requête liste les colonnes explicitement),
-- donc /settings/account renvoie une erreur serveur et la connexion elle-même
-- ne passe plus.
--
-- Purement additif : le code actuellement en production ignore ces colonnes,
-- on peut donc l'appliquer sans rien casser, avant la fusion.
--
-- Généré par `prisma migrate diff` entre le schéma d'avant et celui d'après.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorEnabledAt" TIMESTAMP(3),
ADD COLUMN     "twoFactorSecret" TEXT;

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "firstFailAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_recovery_codes_codeHash_key" ON "two_factor_recovery_codes"("codeHash");

-- CreateIndex
CREATE INDEX "two_factor_recovery_codes_userId_idx" ON "two_factor_recovery_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "login_attempts_key_key" ON "login_attempts"("key");

-- CreateIndex
CREATE INDEX "login_attempts_lockedUntil_idx" ON "login_attempts"("lockedUntil");

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

