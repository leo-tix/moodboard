import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

// POST /api/collections/reorder — persiste l'ordre des COLLECTIONS elles-mêmes.
// Body: { order: string[] } (identifiants de collections dans le nouvel ordre).
//
// Réservé au PROPRIÉTAIRE, à la différence de la réorganisation des images
// d'une collection (ouverte aux éditeurs) : l'ordre porte ici sur la liste
// personnelle de chacun, pas sur un contenu partagé. Le `where` inclut donc
// `userId`, ce qui écarte silencieusement tout identifiant qui n'appartient
// pas à l'appelant plutôt que de lui faire confiance.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const order = body.order as string[] | undefined;
  if (!Array.isArray(order) || order.length === 0) {
    return NextResponse.json({ error: "order manquant" }, { status: 400 });
  }
  if (order.length > 500 || order.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "order invalide" }, { status: 400 });
  }

  await db.$transaction(
    order.map((id, i) =>
      db.collection.updateMany({ where: { id, userId }, data: { order: i } }),
    ),
  );

  return NextResponse.json({ ok: true });
}
