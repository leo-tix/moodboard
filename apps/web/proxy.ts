import { auth } from "@/auth";

// Next.js 16 : "middleware" est renommé "proxy"
export default auth;

export const config = {
  // share/<token> (public moodboard viewer, e.g. /share/4938d918-…) must stay
  // unauthenticated — only the PWA share-target pages (upload/social/done/
  // instagram) under the same /share/ prefix require a session.
  matcher: [
    "/((?!api/auth|api/share|api/import|login|_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|icon|share\\/(?!(?:upload|social|done|instagram)(?:\\/|$))[^\\/]+).*)",
  ],
};
