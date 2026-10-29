"use client";

import { useSearchParams } from "next/navigation";
import { VideoLinkImportClient } from "@/components/upload/VideoLinkImportClient";

export function VideoLinkUrlParam() {
  const params = useSearchParams();
  const url = params.get("url") ?? undefined;
  return <VideoLinkImportClient initialUrl={url} />;
}
