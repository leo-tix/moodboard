import { auth } from "@/auth";

// Next.js 16 : "middleware" est renommé "proxy"
export default auth;

export const config = {
  // share/<token> (public moodboard viewer, e.g. /share/4938d918-…) must stay
  // unauthenticated — only the PWA share-target pages (upload/social/done/
  // instagram) under the same /share/ prefix require a session.
  // carnet/<token> (public visit journal viewer, Phase 5) is likewise public.
  // hors-ligne : coquille PWA servie en repli de navigation par le service
  // worker. Elle DOIT rester hors authentification — sinon le proxy la redirige
  // vers /login, le worker met cette redirection en cache, et l'application
  // devient inutilisable sans réseau (le contraire du but recherché).
  // Elle ne rend aucune donnée serveur : tout vient du stockage local.
  matcher: [
    "/((?!api/auth|api/share|api/import|login|hors-ligne|_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|icon|carnet\\/[^\\/]+|share\\/(?!(?:upload|social|done|instagram)(?:\\/|$))[^\\/]+).*)",
  ],
};
