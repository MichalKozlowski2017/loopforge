import { NextResponse } from "next/server";
import {
  createStartPreset,
  listStartPresets,
} from "@/lib/cloud-presets-store";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.user) {
    return NextResponse.json(
      { error: "Zaloguj się, żeby zobaczyć zapisane starty." },
      { status: 401 },
    );
  }

  try {
    const supabase = await createClient();
    const presets = await listStartPresets(supabase, auth.user.id);
    return NextResponse.json({ presets });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Nie udało się pobrać zapisanych startów.",
      },
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
      { error: "Zaloguj się, żeby zapisać start." },
      { status: 401 },
    );
  }

  let body: { label?: string; lat?: number; lng?: number };
  try {
    body = (await request.json()) as {
      label?: string;
      lat?: number;
      lng?: number;
    };
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe JSON" }, { status: 400 });
  }

  if (
    typeof body.label !== "string" ||
    typeof body.lat !== "number" ||
    typeof body.lng !== "number"
  ) {
    return NextResponse.json(
      { error: "Podaj nazwę oraz współrzędne lat/lng." },
      { status: 400 },
    );
  }

  try {
    const supabase = await createClient();
    const preset = await createStartPreset(supabase, auth.user.id, {
      label: body.label,
      lat: body.lat,
      lng: body.lng,
    });
    return NextResponse.json({ preset }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Nie udało się zapisać startu.",
      },
      { status: 400 },
    );
  }
}
