import { NextResponse } from "next/server";
import { pingBrouter } from "@/lib/admin/stats";
import { requireAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const health = await pingBrouter();
  return NextResponse.json({ health });
}
