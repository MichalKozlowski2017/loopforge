import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/admin/stats";
import { requireAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const stats = await getDashboardStats();
    return NextResponse.json({ stats });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Błąd stats" },
      { status: 500 },
    );
  }
}
