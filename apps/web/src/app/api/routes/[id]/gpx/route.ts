import { NextResponse } from "next/server";
import { getRouteGpx } from "@/lib/cloud-routes-store";
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
      { error: "Zaloguj się, żeby pobrać GPX." },
      { status: 401 },
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Brak id trasy." }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const gpx = await getRouteGpx(supabase, auth.user.id, id);
    if (gpx === null) {
      return NextResponse.json({ error: "Nie znaleziono trasy." }, { status: 404 });
    }
    if (!gpx.trim()) {
      return NextResponse.json({ error: "Brak GPX dla tej trasy." }, { status: 404 });
    }

    return new NextResponse(gpx, {
      status: 200,
      headers: {
        "Content-Type": "application/gpx+xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="loopforge-${id}.gpx"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Nie udało się pobrać GPX." },
      { status: 500 },
    );
  }
}
