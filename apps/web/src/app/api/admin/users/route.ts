import { NextResponse } from "next/server";
import { listAdminUsers } from "@/lib/admin/stats";
import { requireAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const users = await listAdminUsers();
    return NextResponse.json({ users });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Błąd listy użytkowników" },
      { status: 500 },
    );
  }
}
