import { NextResponse } from "next/server";
import { updateRouteRating } from "@/lib/routes-store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const body = (await request.json()) as {
    rating?: "up" | "down";
    notes?: string;
  };

  if (body.rating !== "up" && body.rating !== "down") {
    return NextResponse.json({ error: "Nieprawidłowa ocena" }, { status: 400 });
  }

  const updated = await updateRouteRating(id, body.rating, body.notes);
  if (!updated) {
    return NextResponse.json({ error: "Trasa nie znaleziona" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
