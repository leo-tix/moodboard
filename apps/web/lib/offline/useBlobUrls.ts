"use client";

import { useEffect, useState } from "react";
import type { LocalBlock } from "./localVisits";

/**
 * URL d'objet par bloc porteur d'un blob (photo, croquis).
 *
 * Les URL sont RÉVOQUÉES au démontage et à chaque recomposition : sans ça,
 * chaque re-rendu d'une visite de 50 photos fuirait autant de blobs retenus en
 * mémoire par l'onglet — précisément sur l'appareil où l'on économise le plus.
 * La dépendance est la LISTE DES IDENTIFIANTS porteurs d'un blob, pas le
 * tableau `blocks` (recréé à chaque rendu, ce qui boucherait à l'infini). Elle
 * change aussi quand la synchro libère un blob : l'URL correspondante est alors
 * révoquée d'elle-même.
 */
export function useBlobUrls(blocks: LocalBlock[]): Record<string, string> {
  const cle = blocks.filter((b) => b.blob).map((b) => b.localId).join(",");
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const b of blocks) {
      if (b.blob && (b.type === "photo" || b.type === "sketch")) {
        map[b.localId] = URL.createObjectURL(b.blob);
      }
    }
    setUrls(map);
    return () => { for (const u of Object.values(map)) URL.revokeObjectURL(u); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);
  return urls;
}
