import { NextResponse } from "next/server";
import { getSharedRouteBySlug } from "@/lib/cloud-routes-store";
import {
  createServiceClient,
  isServiceRoleConfigured,
} from "@/lib/supabase/admin";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      { error: "Udostępnianie tras jest chwilowo niedostępne." },
      { status: 503 },
    );
  }

  const { slug } = await params;
  if (!slug) {
    return NextResponse.json({ error: "Brak linku." }, { status: 400 });
  }

  try {
    const route = await getSharedRouteBySlug(createServiceClient(), slug);
    if (!route) {
      return NextResponse.json(
        { error: "Nie znaleziono udostępnionej trasy." },
        { status: 404 },
      );
    }
    return NextResponse.json({ route });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Nie udało się pobrać trasy.",
      },
      { status: 500 },
    );
  }
}
