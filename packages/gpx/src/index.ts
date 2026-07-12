import type { LatLng } from "@loopforge/osm-types";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const EARTH_RADIUS_M = 6_371_000;

function haversineM(a: [number, number], b: [number, number]): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Reduce GPX point density so bike computers follow the corridor, not every OSM kink. */
export function downsampleTrackForNavigation(
  coordinates: [number, number][],
  intervalM = 200,
): [number, number][] {
  if (coordinates.length <= 2) return coordinates;

  const result: [number, number][] = [coordinates[0]];
  let accM = 0;

  for (let i = 1; i < coordinates.length; i++) {
    accM += haversineM(coordinates[i - 1], coordinates[i]);
    if (accM >= intervalM) {
      result.push(coordinates[i]);
      accM = 0;
    }
  }

  const last = coordinates[coordinates.length - 1];
  const prev = result[result.length - 1];
  if (prev[0] !== last[0] || prev[1] !== last[1]) {
    result.push(last);
  }

  return result.length >= 2 ? result : coordinates;
}

export interface BuildGpxOptions {
  /** Sparse track (~200 m) for devices that hyper-follow every OSM vertex. */
  navigation?: boolean;
  /** Point spacing when `navigation` is true (default 200 m). */
  navigationIntervalM?: number;
}

export function buildGpx(
  name: string,
  coordinates: [number, number][],
  start?: LatLng,
  options?: BuildGpxOptions,
): string {
  const track = options?.navigation
    ? downsampleTrackForNavigation(
        coordinates,
        options.navigationIntervalM ?? 200,
      )
    : coordinates;

  const points = track
    .map(
      ([lng, lat]) =>
        `        <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>`,
    )
    .join("\n");

  const metadata =
    start !== undefined
      ? `\n    <metadata>\n      <desc>Start: ${start.lat.toFixed(5)}, ${start.lng.toFixed(5)}</desc>\n    </metadata>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Loopforge" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>${metadata}
    <name>${escapeXml(name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}
