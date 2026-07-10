import { NextResponse } from "next/server";
import { getRouteById } from "@/lib/routes-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const route = await getRouteById(id);

  if (!route) {
    return NextResponse.json({ error: "Trasa nie znaleziona" }, { status: 404 });
  }

  return new NextResponse(route.gpx, {
    headers: {
      "Content-Type": "application/gpx+xml",
      "Content-Disposition": `attachment; filename="loopforge-${id}.gpx"`,
    },
  });
}
