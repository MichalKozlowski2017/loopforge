import { NextResponse } from "next/server";
import { buildGpx } from "@loopforge/gpx";
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

  const name = `Loopforge ${route.bikeType} ${Math.round(route.metrics.distanceKm)}km`;
  const gpx =
    route.gpx ??
    buildGpx(name, route.geojson.geometry.coordinates, route.start);

  return new NextResponse(gpx, {
    headers: {
      "Content-Type": "application/gpx+xml",
      "Content-Disposition": `attachment; filename="loopforge-${id}.gpx"`,
    },
  });
}
