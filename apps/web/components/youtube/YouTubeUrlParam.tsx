"use client";

import { useSearchParams } from "next/navigation";
import { YouTubeImportClient } from "@/components/youtube/YouTubeImportClient";

export function YouTubeUrlParam() {
  const params = useSearchParams();
  const url = params.get("url") ?? undefined;
  return <YouTubeImportClient initialUrl={url} />;
}
