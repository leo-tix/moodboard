"use client";

import { useEffect, useState } from "react";

// Le serveur répond-il VRAIMENT ?
//
// `navigator.onLine` ne dit qu'une chose : l'appareil est associé à un réseau.
// Sur le wifi d'un musée — connecté mais sans accès réel — il vaut `true` alors
// que rien ne passe. Toute l'UI qui dépend du réseau doit donc s'appuyer sur
// une sonde effective, pas sur ce drapeau (constat 2026-08-05).
//
// La ressource sondée est publique et minuscule, et la requête est bornée dans
// le temps : sur un réseau qui « pend », l'absence de réponse vaut réponse.

const SONDE_URL = "/manifest.json";
const DELAI_MS = 3000;
const PERIODE_MS = 15000;

export async function serverReachable(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DELAI_MS);
    const res = await fetch(`${SONDE_URL}?ping=${Date.now()}`, { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * `null` tant que la première sonde n'a pas répondu — les appels le traitent
 * comme « on ne sait pas encore » et n'affirment rien.
 */
export function useServerReachable(): boolean | null {
  const [joignable, setJoignable] = useState<boolean | null>(null);

  useEffect(() => {
    let vivant = true;
    const sonder = () => { serverReachable().then((ok) => { if (vivant) setJoignable(ok); }); };
    sonder();
    const iv = setInterval(sonder, PERIODE_MS);
    window.addEventListener("online", sonder);
    window.addEventListener("offline", sonder);
    // Retour au premier plan : le réseau a pu changer pendant l'absence.
    document.addEventListener("visibilitychange", sonder);
    return () => {
      vivant = false;
      clearInterval(iv);
      window.removeEventListener("online", sonder);
      window.removeEventListener("offline", sonder);
      document.removeEventListener("visibilitychange", sonder);
    };
  }, []);

  return joignable;
}
