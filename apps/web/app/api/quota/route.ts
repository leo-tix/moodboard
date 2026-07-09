import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFullQuotaStatus } from "@/lib/storage/quota";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const quota = await getFullQuotaStatus(session.user.id);
  return NextResponse.json(quota);
}
