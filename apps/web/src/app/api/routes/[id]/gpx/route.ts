import { NextResponse } from "next/server";
import { buildGpx } from "@loopforge/gpx";
import { prepareCoordinatesForNavigation } from "@loopforge/generator";
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

  const hasApproach =
    route.approachEnabled || route.metrics.approachDistanceKm != null;
  const name = hasApproach
    ? `Loopforge ${route.bikeType} ${Math.round(route.metrics.distanceKm)}km wyjazd`
    : `Loopforge ${route.bikeType} ${Math.round(route.metrics.distanceKm)}km`;
  const coordinates = prepareCoordinatesForNavigation(
    route.geojson.geometry.coordinates,
  );
  const gpx = buildGpx(name, coordinates, route.start);

  return new NextResponse(gpx, {
    headers: {
      "Content-Type": "application/gpx+xml",
      "Content-Disposition": `attachment; filename="loopforge-${id}.gpx"`,
    },
  });
}
