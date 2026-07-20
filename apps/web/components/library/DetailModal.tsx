"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { DetailPageClient, type DetailPageData } from "@/components/library/DetailPageClient";

interface Props {
  data: DetailPageData;
}

export function DetailModal({ data }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const close = () => router.back();

  // Fix: Next.js keeps the @modal slot alive during soft navigation to unrelated routes.
  // If the current pathname no longer points to a library detail page, hide the modal.
  if (!/^\/library\//.test(pathname)) {
    return null;
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 md:left-14 xl:left-56 z-[100] bg-[var(--bg-base)]"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <DetailPageClient data={data} onClose={close} isModal />
    </div>
  );
}
