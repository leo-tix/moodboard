import DOMPurify from "isomorphic-dompurify";

/**
 * Nettoyage du HTML riche produit par l'éditeur Tiptap (blocs « note » du
 * carnet de visite).
 *
 * Pourquoi : ce HTML est stocké tel quel puis réinjecté via
 * `dangerouslySetInnerHTML` (components/visits/bento/TileContent.tsx), y
 * compris sur la page publique /carnet/<token>. Sans filtrage, un collaborateur
 * (accès Éditeur) — ou n'importe quel appel direct à l'API — peut y glisser un
 * `<img onerror=…>` qui s'exécutera dans le navigateur du propriétaire et de
 * tous les visiteurs du carnet partagé.
 *
 * La liste blanche correspond exactement à ce que StarterKit peut produire :
 * tout le reste (script, iframe, style, event handlers, `javascript:`) est
 * supprimé par DOMPurify.
 */

const ALLOWED_TAGS = [
  "p", "br", "span", "div",
  "h1", "h2", "h3", "h4",
  "strong", "b", "em", "i", "u", "s", "del", "mark",
  "ul", "ol", "li",
  "blockquote", "code", "pre", "hr",
  "a",
];

const ALLOWED_ATTR = ["href", "target", "rel", "class", "start", "type"];

export function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // Aucune URL exotique : http(s), mailto et ancres internes uniquement.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/)/i,
    // `<a>` restant : on force l'ouverture sûre côté rendu (cf. note-prose).
    ADD_ATTR: ["target"],
    KEEP_CONTENT: true,
  });
}
