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

/** Default max spacing for bike-computer GPX (Wahoo / Garmin). */
export const GPX_NAV_MAX_EDGE_M = 20;

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

/**
 * Optional sparse sampling — NOT for Wahoo/Garmin course files.
 * Prefer densifyTrackForNavigation for bike-computer exports.
 */
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

/**
 * Insert intermediate points so consecutive GPX vertices stay within maxEdgeM.
 * Follows the existing polyline (does not invent shortcuts) — fills long OSM
 * straights where BRouter returns sparse nodes (~100–800 m).
 */
export function densifyTrackForNavigation(
  coordinates: [number, number][],
  maxEdgeM = GPX_NAV_MAX_EDGE_M,
): [number, number][] {
  if (coordinates.length < 2 || maxEdgeM <= 0) return coordinates;

  const result: [number, number][] = [coordinates[0]!];

  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1]!;
    const b = coordinates[i]!;
    const len = haversineM(a, b);
    if (len > maxEdgeM) {
      const steps = Math.ceil(len / maxEdgeM);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    result.push(b);
  }

  return result;
}

export interface BuildGpxOptions {
  /**
   * Sparse track — only for rare non-navigation use. Off by default.
   * Do not enable for bike-computer GPX downloads.
   */
  navigation?: boolean;
  /** Point spacing when `navigation` is true (default 200 m). */
  navigationIntervalM?: number;
  /**
   * Densify long BRouter chords so devices stay on-course (default true).
   * Set false only when you need exact BRouter node geometry.
   */
  densify?: boolean;
  /** Max consecutive GPX edge length when densifying (default 20 m). */
  densifyMaxEdgeM?: number;
}

export function buildGpx(
  name: string,
  coordinates: [number, number][],
  start?: LatLng,
  options?: BuildGpxOptions,
): string {
  let track = coordinates;

  if (options?.navigation) {
    track = downsampleTrackForNavigation(
      track,
      options.navigationIntervalM ?? 200,
    );
  } else if (options?.densify !== false) {
    track = densifyTrackForNavigation(
      track,
      options?.densifyMaxEdgeM ?? GPX_NAV_MAX_EDGE_M,
    );
  }

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
