import { NextResponse } from "next/server";
import { updateRouteRating } from "@/lib/cloud-routes-store";
import {
  isRouteRating,
  sanitizeFeedbackTags,
} from "@/lib/route-feedback";
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

  let body: { rating?: unknown; notes?: unknown; tags?: unknown };
  try {
    body = (await request.json()) as {
      rating?: unknown;
      notes?: unknown;
      tags?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe JSON" }, { status: 400 });
  }

  const ratingRaw =
    typeof body.rating === "string" ? Number(body.rating) : body.rating;
  if (!isRouteRating(ratingRaw)) {
    return NextResponse.json(
      { error: "Ocena musi być liczbą od 1 do 5." },
      { status: 400 },
    );
  }

  const notes =
    typeof body.notes === "string"
      ? body.notes.trim().slice(0, 2000)
      : undefined;
  const tags = sanitizeFeedbackTags(body.tags);

  try {
    const supabase = await createClient();
    const route = await updateRouteRating(
      supabase,
      auth.user.id,
      id,
      ratingRaw,
      notes,
      tags,
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
