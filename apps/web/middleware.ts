import { auth } from "@/auth";

export default auth;

export const config = {
  // Protège toutes les routes sauf login, api/auth, et assets
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)"],
};
