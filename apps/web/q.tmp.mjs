import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
for (const l of readFileSync(".env.local","utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const db = new PrismaClient();
const g = await db.inspiration.groupBy({ by:["userId"], _count:true, orderBy:{_count:{userId:"desc"}}, take:1 });
const imgs = await db.image.findMany({
  where: { inspiration: { userId: g[0].userId, isArchived: false } },
  select: { thumbnailKey: true, width: true, height: true },
});
await db.$disconnect();
console.log("TOTAL=" + imgs.length);
// La base ne stocke QUE les dimensions de l'original. Il faut donc mesurer
// les vignettes réellement servies pour savoir si elles ont le même ratio.
console.log("CLES=" + JSON.stringify(imgs.slice(0,120).map(i => [i.thumbnailKey, i.width, i.height])));
