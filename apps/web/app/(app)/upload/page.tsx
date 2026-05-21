import type { Metadata } from "next";
import { UploadTabs } from "@/components/upload/UploadTabs";

export const metadata: Metadata = { title: "Ajouter" };

export default function UploadPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <header className="mb-8">
        <p className="text-[var(--text-tertiary)] text-xs tracking-widest uppercase mb-1">
          Import
        </p>
        <h1 className="text-2xl font-light text-[var(--text-primary)]">
          Ajouter des références
        </h1>
      </header>

      <UploadTabs />
    </div>
  );
}
