import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current";
import { FolderLab, type FolderImage } from "@/components/visits/FolderLab";
import { ChevronLeft } from "lucide-react";

export const metadata: Metadata = { title: "Partager en dossier" };

interface Props { params: Promise<{ id: string }> }

// Module de partage "folder lab" (Phase 5) pré-rempli avec les images d'une
// visite. Clone de folderlab.javii.tools.
export default async function DossierPage({ params }: Props) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const visit = await db.visit.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      place: true,
      inspirations: {
        where: { status: "READY" },
        select: {
          id: true,
          visitOrder: true,
          createdAt: true,
          images: { select: { storageKey: true, thumbnailKey: true }, orderBy: [{ isMain: "desc" }, { order: "asc" }], take: 1 },
        },
      },
    },
  });

  if (!visit) notFound();

  const images: FolderImage[] = [...visit.inspirations]
    .sort((a, b) => a.visitOrder - b.visitOrder || a.createdAt.getTime() - b.createdAt.getTime())
    .map((i) => ({ id: i.id, thumbnailKey: i.images[0]?.thumbnailKey ?? null, storageKey: i.images[0]?.storageKey ?? "" }))
    .filter((i) => i.storageKey);

  return (
    <div className="relative">
      <Link
        href={`/visites/${visit.id}`}
        className="fixed top-4 left-4 z-[200] inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs bg-[#1a1a1a] text-white/80 hover:text-white border border-white/10 transition-colors"
      >
        <ChevronLeft size={13} strokeWidth={2} /> Retour au carnet
      </Link>
      {images.length === 0 ? (
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-6 text-center">
          <p className="text-sm text-white/50">Ajoute des images à cette visite pour créer un dossier à partager.</p>
        </div>
      ) : (
        <FolderLab images={images} />
      )}
    </div>
  );
}
