import { NextResponse } from "next/server";
import { setRouteSharing } from "@/lib/cloud-routes-store";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.user) {
    return NextResponse.json(
      { error: "Zaloguj się, żeby udostępnić trasę." },
      { status: 401 },
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Brak id trasy." }, { status: 400 });
  }

  let body: { enabled?: unknown };
  try {
    body = (await request.json()) as { enabled?: unknown };
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe JSON" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "Podaj enabled: true|false." },
      { status: 400 },
    );
  }

  try {
    const supabase = await createClient();
    const route = await setRouteSharing(
      supabase,
      auth.user.id,
      id,
      body.enabled,
    );
    if (!route) {
      return NextResponse.json({ error: "Nie znaleziono trasy." }, { status: 404 });
    }
    return NextResponse.json({ route });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Nie udało się zmienić udostępniania.",
      },
      { status: 500 },
    );
  }
}
