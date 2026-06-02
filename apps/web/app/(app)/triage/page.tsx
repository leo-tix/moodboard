import type { Metadata } from "next";
import { TriageClient } from "@/components/triage/TriageClient";

export const metadata: Metadata = { title: "Triage" };

export default function TriagePage() {
  return <TriageClient />;
}
