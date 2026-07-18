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
          PAS de overflow-x-hidden ici : sur iOS Safari, contraindre l'overflow
          du conteneur de défilement casse `position: sticky` des enfants (la
          barre du haut de visite disparaissait au scroll — retour 2026-07-18).
          Le débordement horizontal parasite est réglé à la SOURCE (halo de la
          cover contraint horizontalement). */}
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
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
