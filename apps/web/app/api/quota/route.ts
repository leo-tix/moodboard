import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFullQuotaStatus } from "@/lib/storage/quota";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const quota = await getFullQuotaStatus();
  return NextResponse.json(quota);
}
