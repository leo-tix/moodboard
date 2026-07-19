// Validation des timings par mot (Whisper) — donnée persistée librement en
// Json et reçue en multipart depuis le client : on ne fait confiance qu'à la
// forme attendue { word: string, start: number, end: number }, sinon null
// (repli sur l'estimation côté UI). Partagé entre les routes d'upload audio
// (carnet + planches) et le résolveur de tuiles (lib/visits/journalItems.ts).

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

/** Valide une valeur déjà désérialisée (Json de la base, ou tableau). */
export function parseWordTimings(v: unknown): WordTiming[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: WordTiming[] = [];
  for (const w of v) {
    if (
      w &&
      typeof w === "object" &&
      typeof (w as { word?: unknown }).word === "string" &&
      typeof (w as { start?: unknown }).start === "number" &&
      typeof (w as { end?: unknown }).end === "number"
    ) {
      const t = w as WordTiming;
      out.push({ word: t.word, start: t.start, end: t.end });
    }
  }
  return out.length > 0 ? out : null;
}

/** Valide un champ multipart (chaîne JSON) reçu d'un formulaire d'upload. */
export function parseWordTimingsField(raw: FormDataEntryValue | null): WordTiming[] | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return parseWordTimings(JSON.parse(raw));
  } catch {
    return null;
  }
}
