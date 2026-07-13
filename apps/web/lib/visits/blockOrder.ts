import { db } from "@/lib/db";

// Les 6 types de blocs du carnet (image/note/titre/citation/audio/colonnes)
// partagent un même espace de tri séquentiel (voir schema.prisma). Un
// nouveau bloc ajouté "en fin de carnet" doit regarder le max des 6 tables.
export async function nextBlockOrder(visitId: string): Promise<number> {
  const [img, note, title, quote, audio, columns] = await Promise.all([
    db.inspiration.aggregate({ where: { visitId }, _max: { visitOrder: true } }),
    db.visitNote.aggregate({ where: { visitId }, _max: { order: true } }),
    db.visitTitle.aggregate({ where: { visitId }, _max: { order: true } }),
    db.visitQuote.aggregate({ where: { visitId }, _max: { order: true } }),
    db.visitAudio.aggregate({ where: { visitId }, _max: { order: true } }),
    db.visitColumns.aggregate({ where: { visitId }, _max: { order: true } }),
  ]);
  return (
    Math.max(
      img._max.visitOrder ?? -1,
      note._max.order ?? -1,
      title._max.order ?? -1,
      quote._max.order ?? -1,
      audio._max.order ?? -1,
      columns._max.order ?? -1,
    ) + 1
  );
}
