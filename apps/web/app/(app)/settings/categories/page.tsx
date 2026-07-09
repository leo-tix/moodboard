import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { CategoryManager } from "@/components/settings/CategoryManager";

export const metadata = { title: "Catégories" };

export default async function CategoriesSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Taxonomie partagée : seul l'admin peut la modifier. Les autres profils la
  // voient en lecture seule.
  return <CategoryManager isAdmin={user.role === "ADMIN"} />;
}
