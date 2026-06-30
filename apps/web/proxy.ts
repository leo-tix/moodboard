import { auth } from "@/auth";

// Next.js 16 : "middleware" est renommé "proxy"
export default auth;

export const config = {
  matcher: ["/((?!api/auth|api/share|api/import|login|_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|icon).*)"],
};
