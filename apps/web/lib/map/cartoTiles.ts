// CARTO exige désormais une clé API pour ses basemaps utilisés hors de sa
// propre plateforme (Leaflet, MapLibre…) — sans clé, les tuiles se chargent
// toujours mais sont recouvertes d'un filigrane "API KEY REQUIRED" (bug
// remonté 2026-10-16). Clé gratuite (jusqu'à 5M requêtes/mois en usage non
// commercial) : https://carto.com/basemaps/apikey/ — à mettre dans
// NEXT_PUBLIC_CARTO_API_KEY. Sans variable d'env définie, on retombe sur le
// nouveau schéma d'URL sans clé (filigrane visible mais carte fonctionnelle).
const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY;
const KEY_PARAM = CARTO_API_KEY ? `?key=${CARTO_API_KEY}` : "";

export const CARTO_DARK_TILE_URL = `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png${KEY_PARAM}`;

export const CARTO_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>';
