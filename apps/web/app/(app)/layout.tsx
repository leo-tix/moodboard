import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { GlobalUploadProvider } from "@/components/upload/GlobalUploadProvider";
import { PageTransition } from "@/components/layout/PageTransition";

export default async function AppLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Nom + avatar pour le pied de la sidebar (re-requêté à chaque navigation,
  // donc reflète immédiatement un changement de profil via router.refresh()).
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, image: true },
  });

  return (
    <div className="flex h-screen bg-[var(--bg-base)] overflow-hidden">
      {/* Sidebar — desktop only */}
      <Sidebar
        user={{
          name: user?.name ?? null,
          email: user?.email ?? "",
          image: user?.image ?? null,
        }}
      />

      {/* Main content — bottom padding on mobile to clear the bottom nav.
          overflow-x-hidden : sans lui, `overflow-y-auto` calcule l'axe X à
          `auto`, si bien que le moindre débordement horizontal (ex. le halo
          flouté -inset-8 derrière la cover de visite) rendait la page
          légèrement glissable de quelques px sur mobile (retour utilisateur
          2026-07-18). Clippe le débordement horizontal sans toucher au scroll
          vertical ni au `position: sticky` (ce <main> reste le scroller). */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-16 md:pb-0">
        <GlobalUploadProvider>
          <PageTransition>{children}</PageTransition>
        </GlobalUploadProvider>
      </main>

      {/* Bottom nav — mobile only */}
      <BottomNav />

      {/* Intercepted modal (e.g. /library/[id] opened from library grid) */}
      {modal}
    </div>
  );
}
