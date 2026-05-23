"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { DetailPageClient, type DetailPageData } from "@/components/library/DetailPageClient";

interface Props {
  data: DetailPageData;
}

export function DetailModal({ data }: Props) {
  const router = useRouter();
  const close = () => router.back();

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
    <div className="fixed inset-0 md:left-14 lg:left-56 z-[100] bg-[var(--bg-base)]">
      <DetailPageClient data={data} onClose={close} isModal />
    </div>
  );
}
