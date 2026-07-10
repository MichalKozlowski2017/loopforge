import type { Direction, LatLng } from "@loopforge/osm-types";

const DIRECTION_BEARING: Record<Direction, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function destinationPoint(
  start: LatLng,
  bearingDeg: number,
  distanceM: number,
): LatLng {
  const bearing = toRadians(bearingDeg);
  const lat1 = toRadians(start.lat);
  const lng1 = toRadians(start.lng);
  const angular = distanceM / EARTH_RADIUS_M;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDegrees(lat2), lng: toDegrees(lng2) };
}

/** Build 3 waypoints forming a loop biased toward `direction`. */
export function buildLoopWaypoints(
  start: LatLng,
  distanceKm: number,
  direction: Direction,
  variant: number,
): LatLng[] {
  const spreads = [0, 18, -18, 30, -30, 45, -45, 0];
  const turns = [85, 95, 75, 110, 65, 100, 80, 90];
  const legScales = [1.0, 0.92, 1.08, 0.88, 1.12, 0.95, 1.05, 1.0];

  const baseBearing = DIRECTION_BEARING[direction] + spreads[variant % spreads.length];
  const legM = ((distanceKm * 1000) / 3.5) * legScales[variant % legScales.length];
  const turn = turns[variant % turns.length];

  const wp1 = destinationPoint(start, baseBearing, legM);
  const wp2 = destinationPoint(wp1, baseBearing + turn, legM * 1.05);
  const wp3 = destinationPoint(wp2, baseBearing + turn + turn - 10, legM * 0.95);

  return [wp1, wp2, wp3];
}

/** Grid-based overlap: share of points revisiting same ~25m cell. */
export function overlapRatio(coordinates: [number, number][]): number {
  if (coordinates.length < 2) return 0;

  const seen = new Set<string>();
  let duplicates = 0;

  for (const [lng, lat] of coordinates) {
    const key = `${Math.round(lng * 2000)},${Math.round(lat * 2000)}`;
    if (seen.has(key)) duplicates++;
    seen.add(key);
  }

  return duplicates / coordinates.length;
}

/** Detect short out-and-back spurs (same segment reversed within ~40 points). */
export function backtrackRatio(coordinates: [number, number][]): number {
  if (coordinates.length < 10) return 0;

  let spurs = 0;
  const window = 40;
  const thresholdM = 35;

  for (let i = 0; i < coordinates.length - 3; i++) {
    const a = { lng: coordinates[i][0], lat: coordinates[i][1] };
    const b = { lng: coordinates[i + 1][0], lat: coordinates[i + 1][1] };

    for (let j = i + 2; j < Math.min(i + window, coordinates.length - 1); j++) {
      const c = { lng: coordinates[j][0], lat: coordinates[j][1] };
      const d = { lng: coordinates[j + 1][0], lat: coordinates[j + 1][1] };

      const ab = segmentLengthM(a, b);
      if (ab < 15) continue;

      const rev =
        haversineM(a, d) < thresholdM && haversineM(b, c) < thresholdM;
      if (rev) {
        spurs++;
        break;
      }
    }
  }

  return spurs / Math.max(1, coordinates.length / 10);
}

function segmentLengthM(a: LatLng, b: LatLng): number {
  return haversineM(a, b);
}

function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function scoreLoopQuality(
  coordinates: [number, number][],
  targetDistanceKm: number,
  actualDistanceKm: number,
): number {
  const overlap = overlapRatio(coordinates);
  const backtrack = backtrackRatio(coordinates);
  const distanceError =
    Math.abs(actualDistanceKm - targetDistanceKm) / targetDistanceKm;

  return overlap * 2 + backtrack * 3 + distanceError;
}
