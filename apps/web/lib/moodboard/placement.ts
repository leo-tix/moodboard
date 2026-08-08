export interface Boite {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Premier emplacement LIBRE pour une nouvelle boîte, au plus près d'un point.
 *
 * L'ajout depuis la bibliothèque déposait jusqu'ici tout au centre du
 * viewport : en enchaîner dix produisait une pile de dix images superposées,
 * qu'il fallait démêler à la main. On cherche donc en spirale autour du point
 * visé et l'on s'arrête au premier creux.
 *
 * `marge` évite les images qui se frôlent, visuellement pires que franchement
 * séparées.
 */
export function placerAuPremierCreux(
  occupees: Boite[],
  taille: { w: number; h: number },
  autour: { x: number; y: number },
  marge = 16,
): { x: number; y: number } {
  const chevauche = (x: number, y: number) =>
    occupees.some(
      (o) =>
        x < o.x + o.w + marge &&
        x + taille.w + marge > o.x &&
        y < o.y + o.h + marge &&
        y + taille.h + marge > o.y,
    );

  const depart = { x: autour.x - taille.w / 2, y: autour.y - taille.h / 2 };
  if (!chevauche(depart.x, depart.y)) return depart;

  // Spirale d'Archimède plutôt qu'une grille : elle privilégie la proximité au
  // point visé quelle que soit la direction, là où une grille remplirait
  // toujours vers la même diagonale et décentrerait la planche à la longue.
  const pas = Math.max(40, Math.min(taille.w, taille.h) / 2);
  const ANGLE_OR = 2.399963;
  for (let i = 1; i < 900; i++) {
    const r = pas * Math.sqrt(i) * 0.9;
    const a = i * ANGLE_OR;
    const x = depart.x + Math.cos(a) * r;
    const y = depart.y + Math.sin(a) * r;
    if (!chevauche(x, y)) return { x, y };
  }
  // Planche saturée : on rend le point visé plutôt que rien. Superposer reste
  // préférable à un ajout qui échoue en silence.
  return depart;
}
