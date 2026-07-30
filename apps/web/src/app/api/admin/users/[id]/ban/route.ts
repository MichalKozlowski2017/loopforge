import { NextResponse } from "next/server";
import { setUserBanned } from "@/lib/admin/stats";
import { requireAdmin } from "@/lib/supabase/admin";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Brak id użytkownika." }, { status: 400 });
  }
  if (id === auth.user.id) {
    return NextResponse.json(
      { error: "Nie możesz zbanować własnego konta." },
      { status: 400 },
    );
  }

  let body: { banned?: boolean };
  try {
    body = (await request.json()) as { banned?: boolean };
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe JSON" }, { status: 400 });
  }
  if (typeof body.banned !== "boolean") {
    return NextResponse.json({ error: "Pole banned jest wymagane." }, { status: 400 });
  }

  try {
    await setUserBanned(id, body.banned);
    return NextResponse.json({ ok: true, banned: body.banned });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Nie udało się zmienić bana." },
      { status: 500 },
    );
  }
}
