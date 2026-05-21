import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { GlobalUploadProvider } from "@/components/upload/GlobalUploadProvider";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen bg-[var(--bg-base)] overflow-hidden">
      {/* Sidebar — desktop only */}
      <Sidebar />

      {/* Main content — bottom padding on mobile to clear the bottom nav */}
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <GlobalUploadProvider>
          {children}
        </GlobalUploadProvider>
      </main>

      {/* Bottom nav — mobile only */}
      <BottomNav />
    </div>
  );
}
