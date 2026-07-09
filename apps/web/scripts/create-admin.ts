/**
 * Script one-shot pour créer le compte admin.
 * Lance avec : npx tsx scripts/create-admin.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("❌ Définis ADMIN_EMAIL et ADMIN_PASSWORD dans .env.local");
    process.exit(1);
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    console.log("✅ Compte admin déjà existant :", email);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.create({
    // ADMIN + quota généreux (le multi-profils répartit le bucket via /settings/profiles)
    data: {
      email,
      passwordHash,
      name: "Admin",
      role: "ADMIN",
      storageQuotaBytes: BigInt(4 * 1024 * 1024 * 1024),
    },
  });

  console.log("✅ Compte admin créé :", user.email);
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
