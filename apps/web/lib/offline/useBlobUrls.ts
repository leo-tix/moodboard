"use client";

import { useEffect, useMemo } from "react";
import type { LocalBlock } from "./localVisits";

/**
 * URL d'objet par fichier local, pour l'afficher avant tout envoi.
 *
 * Deux familles de clés :
 *  · `<localId>`         — le fichier PRINCIPAL du bloc (photo, croquis, mémo) ;
 *  · `<localId>:<nom>`   — un fichier JOINT à un module (photo de billet,
 *                          image source d'une palette).
 *
 * Construit en `useMemo` et non en état+effet : cette seconde forme rendait
 * d'abord une passe SANS aucune URL, d'où un carnet qui s'affichait vide puis
 * se remplissait. Ici les URL existent dès le premier rendu.
 *
 * Elles sont RÉVOQUÉES quand la composition change et au démontage. Sans ça,
 * une visite de 50 photos retiendrait autant de blobs en mémoire à chaque
 * recomposition — précisément sur l'appareil où l'on économise le plus. La
 * dépendance est la LISTE DES CLÉS porteuses d'un blob, pas le tableau
 * `blocks`, recréé à chaque rendu. Elle change aussi quand la synchro libère
 * un blob : l'URL correspondante est alors révoquée d'elle-même.
 */
export function useBlobUrls(blocks: LocalBlock[]): Record<string, string> {
  const cle = blocks
    .flatMap((b) => [
      ...(b.blob ? [b.localId] : []),
      ...Object.keys(b.files ?? {}).map((n) => `${b.localId}:${n}`),
    ])
    .join(",");

  const urls = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of blocks) {
      // Le mémo vocal en fait partie : le lecteur audio du carnet lit une URL,
      // peu importe qu'elle vienne de R2 ou d'un blob local.
      if (b.blob) map[b.localId] = URL.createObjectURL(b.blob);
      for (const [nom, f] of Object.entries(b.files ?? {})) {
        map[`${b.localId}:${nom}`] = URL.createObjectURL(f.blob);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  useEffect(
    () => () => { for (const u of Object.values(urls)) URL.revokeObjectURL(u); },
    [urls],
  );

  return urls;
}
