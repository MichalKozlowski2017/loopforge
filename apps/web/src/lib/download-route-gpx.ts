import { buildGpx } from "@loopforge/gpx";
import type { StoredRoute } from "@loopforge/osm-types";

/**
 * Export the full routed polyline for bike computers.
 * Do not thin to ~200 m — Wahoo/Garmin treat sparse chords as the course line
 * and go off-course whenever the real path curves away from the chord.
 */
export function buildRouteGpxContent(route: StoredRoute): string {
  const hasApproach =
    route.approachEnabled || route.metrics.approachDistanceKm != null;
  const name = hasApproach
    ? `Loopforge ${route.bikeType} ${Math.round(route.metrics.distanceKm)}km wyjazd`
    : `Loopforge ${route.bikeType} ${Math.round(route.metrics.distanceKm)}km`;
  const coordinates = route.geojson.geometry.coordinates as [number, number][];
  return buildGpx(name, coordinates, route.start);
}

export function downloadRouteGpx(route: StoredRoute): void {
  const gpx = buildRouteGpxContent(route);
  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `loopforge-${route.id}.gpx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
