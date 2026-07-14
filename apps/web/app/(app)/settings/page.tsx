import { redirect } from "next/navigation";

export default function SettingsPage() {
  // "/settings/general" n'existe pas (jamais eu de page onglet "Général" —
  // seuls account/categories/extensions/profiles existent, voir SettingsNav) ;
  // "Compte" a sa propre entrée de nav séparée, donc "Réglages" atterrit sur
  // le premier onglet restant (bug remonté 2026-07-14 : 404 sur mobile ET desktop).
  redirect("/settings/categories");
}
