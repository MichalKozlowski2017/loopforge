import { buildGpx } from "@loopforge/gpx";
import type { StoredRoute } from "@loopforge/osm-types";

/**
 * Export densified BRouter geometry for bike computers (~20 m max edge).
 * Never thin — sparse chords cause Wahoo off-course / rerouting.
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
