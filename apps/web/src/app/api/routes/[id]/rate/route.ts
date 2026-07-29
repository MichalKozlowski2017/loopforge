import { NextResponse } from "next/server";
import { updateRouteRating } from "@/lib/cloud-routes-store";
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
      { error: "Zaloguj się, żeby ocenić trasę." },
      { status: 401 },
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Brak id trasy." }, { status: 400 });
  }

  let body: { rating?: "up" | "down"; notes?: string };
  try {
    body = (await request.json()) as { rating?: "up" | "down"; notes?: string };
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe JSON" }, { status: 400 });
  }

  if (body.rating !== "up" && body.rating !== "down") {
    return NextResponse.json({ error: "Nieprawidłowa ocena." }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const route = await updateRouteRating(
      supabase,
      auth.user.id,
      id,
      body.rating,
      body.notes,
    );
    if (!route) {
      return NextResponse.json({ error: "Nie znaleziono trasy." }, { status: 404 });
    }
    return NextResponse.json({ route });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Nie udało się zapisać oceny." },
      { status: 500 },
    );
  }
}
