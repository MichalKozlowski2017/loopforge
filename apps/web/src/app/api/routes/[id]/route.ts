import { NextResponse } from "next/server";
import { getRouteById } from "@/lib/cloud-routes-store";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.user) {
    return NextResponse.json(
      { error: "Zaloguj się, żeby zobaczyć trasę." },
      { status: 401 },
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Brak id trasy." }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const route = await getRouteById(supabase, auth.user.id, id);
    if (!route) {
      return NextResponse.json({ error: "Nie znaleziono trasy." }, { status: 404 });
    }
    return NextResponse.json({ route });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Nie udało się pobrać trasy." },
      { status: 500 },
    );
  }
}
