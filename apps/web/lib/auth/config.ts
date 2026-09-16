import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { loginSchema } from "@/lib/validators/auth";
import { decryptSecret } from "@/lib/auth/secretBox";
import { verifyTotp } from "@/lib/auth/totp";
import { consumeRecoveryCode } from "@/lib/auth/recoveryCodes";
import { checkLockout, clearFailures, clientIp, registerFailure } from "@/lib/auth/throttle";
import {
  InvalidCredentialsError,
  TooManyAttemptsError,
  TwoFactorInvalidError,
  TwoFactorRequiredError,
} from "@/lib/auth/errors";

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 jours
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnLoginPage = nextUrl.pathname === "/login";

      if (isOnLoginPage) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }

      if (!isLoggedIn) return false;
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      } else if (token.id && !token.role) {
        // Jeton émis avant l'ajout du rôle (multi-profils) → hydrate depuis la DB
        // une seule fois, puis le rôle reste dans le token.
        const dbUser = await db.user.findUnique({
          where: { id: token.id as string },
          select: { role: true },
        });
        if (dbUser) token.role = dbUser.role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      if (token.role) session.user.role = token.role as "ADMIN" | "USER";
      return session;
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
        // Second facteur : l'un OU l'autre, envoyés au second passage du
        // formulaire de connexion (cf. app/(auth)/login/page.tsx).
        totp: {},
        recoveryCode: {},
      },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        // Un mot de passe trop court ne peut correspondre à aucun compte : on
        // s'arrête avant la base, mais on compte quand même la tentative côté IP.
        const ip = clientIp(request);
        if (!parsed.success) {
          await registerFailure({ ip });
          throw new InvalidCredentialsError();
        }

        const email = parsed.data.email.toLowerCase();
        const keys = { email, ip };

        const lockedFor = await checkLockout(keys);
        if (lockedFor > 0) throw new TooManyAttemptsError();

        const user = await db.user.findUnique({ where: { email } });

        // Compte inexistant : on compare quand même contre un faux condensat
        // pour que la réponse prenne le même temps qu'un mot de passe erroné
        // (sinon le temps de réponse révèle quels emails existent).
        if (!user) {
          await bcrypt.compare(parsed.data.password, DUMMY_HASH);
          await registerFailure(keys);
          throw new InvalidCredentialsError();
        }

        const passwordMatch = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!passwordMatch) {
          await registerFailure(keys);
          throw new InvalidCredentialsError();
        }

        // ── Second facteur ──────────────────────────────────────────────────
        if (user.twoFactorEnabled) {
          const totp = typeof credentials?.totp === "string" ? credentials.totp.trim() : "";
          const recovery =
            typeof credentials?.recoveryCode === "string" ? credentials.recoveryCode.trim() : "";

          // Rien de fourni → le formulaire doit afficher le champ du code.
          // Ce n'est pas un échec : on ne compte pas la tentative.
          if (!totp && !recovery) throw new TwoFactorRequiredError();

          const secret = decryptSecret(user.twoFactorSecret);
          const totpOk = Boolean(totp) && Boolean(secret) && verifyTotp(secret!, totp);
          const recoveryOk = !totpOk && Boolean(recovery) && (await consumeRecoveryCode(user.id, recovery));

          if (!totpOk && !recoveryOk) {
            await registerFailure(keys);
            throw new TwoFactorInvalidError();
          }
        }

        await clearFailures(keys);
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
};

// Condensat bcrypt d'une valeur qui n'est le mot de passe de personne : sert
// uniquement à égaliser le temps de réponse sur un email inconnu.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.7ZVJ9oQ0xKoZ1FZ8rLwKQ1dJ0N1v6Yy";
