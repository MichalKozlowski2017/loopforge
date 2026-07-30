import { NextResponse } from "next/server";
import { listDownFeedback } from "@/lib/admin/stats";
import { requireAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const feedback = await listDownFeedback();
    return NextResponse.json({ feedback });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Błąd feedback" },
      { status: 500 },
    );
  }
}
