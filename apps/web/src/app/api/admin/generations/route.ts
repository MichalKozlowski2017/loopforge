import { NextResponse } from "next/server";
import { listGenerations } from "@/lib/admin/stats";
import { requireAdmin } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const status =
    statusParam === "success" || statusParam === "error" ? statusParam : undefined;

  try {
    const generations = await listGenerations(80, status);
    return NextResponse.json({ generations });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Błąd generations" },
      { status: 500 },
    );
  }
}
