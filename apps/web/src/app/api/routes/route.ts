import { NextResponse } from "next/server";
import type { StoredRoute } from "@loopforge/osm-types";
import {
  listFavoriteSummaries,
  listRouteSummaries,
  saveRoute,
} from "@/lib/cloud-routes-store";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.user) {
    return NextResponse.json(
      { error: "Zaloguj się, żeby zobaczyć historię tras." },
      { status: 401 },
    );
  }

  const favoritesOnly =
    new URL(request.url).searchParams.get("favorites") === "1";

  try {
    const supabase = await createClient();
    const routes = favoritesOnly
      ? await listFavoriteSummaries(supabase, auth.user.id)
      : await listRouteSummaries(supabase, auth.user.id);
    return NextResponse.json({ routes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Nie udało się pobrać historii." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.user) {
    return NextResponse.json(
      { error: "Zaloguj się, żeby zapisać trasę." },
      { status: 401 },
    );
  }

  let body: StoredRoute;
  try {
    body = (await request.json()) as StoredRoute;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe JSON" }, { status: 400 });
  }

  if (
    !body?.id ||
    !body.bikeType ||
    !body.direction ||
    !body.start ||
    !body.geojson ||
    !body.metrics ||
    !body.createdAt
  ) {
    return NextResponse.json(
      { error: "Niepełne dane trasy do zapisu." },
      { status: 400 },
    );
  }

  try {
    const supabase = await createClient();
    const saved = await saveRoute(supabase, auth.user.id, body);
    return NextResponse.json({ route: saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Nie udało się zapisać trasy." },
      { status: 500 },
    );
  }
}
