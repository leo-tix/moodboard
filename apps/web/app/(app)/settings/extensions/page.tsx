import type { Metadata } from "next";
import { ExtensionsSection } from "@/components/settings/ExtensionsSection";

export const metadata: Metadata = { title: "Extensions" };

export default function ExtensionsPage() {
  return (
    <div className="p-6 max-w-xl">
      <h2 className="text-sm font-medium text-[var(--text-primary)] mb-6">Extensions</h2>
      <ExtensionsSection />
    </div>
  );
}
