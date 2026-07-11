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

function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function pathLengthM(
  coordinates: [number, number][],
  fromIndex: number,
  toIndex: number,
): number {
  let meters = 0;
  const start = Math.max(0, fromIndex);
  const end = Math.min(toIndex, coordinates.length - 1);
  for (let i = start; i < end; i++) {
    meters += haversineM(
      { lng: coordinates[i][0], lat: coordinates[i][1] },
      { lng: coordinates[i + 1][0], lat: coordinates[i + 1][1] },
    );
  }
  return meters;
}

function pointOnEllipse(
  center: LatLng,
  semiMajorM: number,
  semiMinorM: number,
  majorBearingDeg: number,
  angleDeg: number,
): LatLng {
  const t = toRadians(angleDeg);
  const eastM = semiMajorM * Math.sin(t);
  const northM = semiMinorM * Math.cos(t);
  const dist = Math.hypot(eastM, northM);
  const localBearing = toDegrees(Math.atan2(eastM, northM));
  return destinationPoint(center, majorBearingDeg + localBearing, dist);
}

const VARIANT_POINT_COUNTS = [5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4];
const VARIANT_SCALES = [
  1.0, 0.9, 1.1, 0.85, 1.15, 0.92, 1.08, 0.88, 1.12, 0.95, 1.05, 0.87, 1.13,
  0.93, 1.07, 1.0,
];
const VARIANT_ROTATIONS = [
  0, 18, -18, 36, -36, 12, -12, 24, -24, 30, -30, 6, -6, 42, -42, 0,
];
const VARIANT_ASPECTS = [
  0.72, 0.68, 0.76, 0.7, 0.74, 0.66, 0.78, 0.72, 0.7, 0.75, 0.69, 0.73, 0.71,
  0.77, 0.67, 0.74,
];

/**
 * Place waypoints on an ellipse biased toward `direction`.
 * Smoother than a 3-point triangle — fewer dead-end spurs when routed on OSM.
 */
export function buildLoopWaypoints(
  start: LatLng,
  distanceKm: number,
  direction: Direction,
  variant: number,
): LatLng[] {
  const baseBearing = DIRECTION_BEARING[direction];
  const idx = variant % VARIANT_POINT_COUNTS.length;
  const pointCount = VARIANT_POINT_COUNTS[idx];
  const scale = VARIANT_SCALES[idx];
  const rotation = VARIANT_ROTATIONS[idx];
  const aspect = VARIANT_ASPECTS[idx];

  // Routed roads are longer than straight chords — scale up vs. ideal circle.
  const radiusM =
    ((distanceKm * 1000) / (2 * Math.PI)) * 1.38 * scale;
  const semiMajorM = radiusM;
  const semiMinorM = radiusM * aspect;

  // Offset center slightly opposite to direction so the loop bulges that way.
  const center = destinationPoint(start, baseBearing + 180, radiusM * 0.32);
  const stepDeg = 360 / pointCount;
  const firstAngle = rotation;

  const waypoints: LatLng[] = [];
  for (let i = 0; i < pointCount; i++) {
    waypoints.push(
      pointOnEllipse(
        center,
        semiMajorM,
        semiMinorM,
        baseBearing,
        firstAngle + i * stepDeg,
      ),
    );
  }

  return waypoints;
}

const MAX_QUALITY_POINTS = 600;

/** Downsample for O(n²) spur checks — keeps endpoints and evenly spaced points. */
export function downsampleCoordinates(
  coordinates: [number, number][],
  maxPoints: number,
): [number, number][] {
  if (coordinates.length <= maxPoints) return coordinates;
  const step = (coordinates.length - 1) / (maxPoints - 1);
  const sampled: [number, number][] = [];
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(coordinates[Math.round(i * step)]);
  }
  return sampled;
}

/** Grid-based overlap: share of points revisiting same ~25m cell. */
export function overlapRatio(coordinates: [number, number][]): number {
  coordinates = downsampleCoordinates(coordinates, MAX_QUALITY_POINTS);
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
  coordinates = downsampleCoordinates(coordinates, MAX_QUALITY_POINTS);
  if (coordinates.length < 10) return 0;

  let spurs = 0;
  const window = Math.min(280, Math.max(80, Math.floor(coordinates.length * 0.5)));
  const thresholdM = 35;

  for (let i = 0; i < coordinates.length - 3; i++) {
    const a = { lng: coordinates[i][0], lat: coordinates[i][1] };
    const b = { lng: coordinates[i + 1][0], lat: coordinates[i + 1][1] };

    const ab = haversineM(a, b);
    if (ab < 15) continue;

    for (let j = i + 2; j < Math.min(i + window, coordinates.length - 1); j++) {
      const c = { lng: coordinates[j][0], lat: coordinates[j][1] };
      const d = { lng: coordinates[j + 1][0], lat: coordinates[j + 1][1] };

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

/** Meters of route spent on out-and-back spurs (dead-end u-turns). */
export function spurLengthM(coordinates: [number, number][]): number {
  coordinates = downsampleCoordinates(coordinates, MAX_QUALITY_POINTS);
  if (coordinates.length < 12) return 0;

  let spurM = 0;
  const minGap = 8;
  const matchM = 40;
  const window = Math.min(280, Math.max(60, Math.floor(coordinates.length * 0.5)));

  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = { lng: coordinates[i][0], lat: coordinates[i][1] };
    const b = { lng: coordinates[i + 1][0], lat: coordinates[i + 1][1] };
    const segLen = haversineM(a, b);
    if (segLen < 12) continue;

    const fwd = bearingDeg(a, b);

    for (let j = i + minGap; j < Math.min(i + window, coordinates.length - 1); j++) {
      const c = { lng: coordinates[j][0], lat: coordinates[j][1] };
      const d = { lng: coordinates[j + 1][0], lat: coordinates[j + 1][1] };

      const exactReverse =
        haversineM(a, d) < matchM && haversineM(b, c) < matchM;
      if (exactReverse) {
        spurM += pathLengthM(coordinates, i, j + 1);
        break;
      }

      const rev = bearingDeg(c, d);
      const bearingDelta = Math.abs(((fwd - rev + 540) % 360) - 180);
      if (bearingDelta > 30) continue;

      const midA = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
      const midB = { lat: (c.lat + d.lat) / 2, lng: (c.lng + d.lng) / 2 };
      if (haversineM(midA, midB) < matchM) {
        spurM += pathLengthM(coordinates, i, j + 1);
        break;
      }
    }
  }

  return spurM;
}

export function loopQualityMetrics(
  coordinates: [number, number][],
  targetDistanceKm: number,
  actualDistanceKm: number,
) {
  const overlap = overlapRatio(coordinates);
  const backtrack = backtrackRatio(coordinates);
  const spurM = spurLengthM(coordinates);
  const spurShare =
    actualDistanceKm > 0 ? spurM / (actualDistanceKm * 1000) : 0;
  const distanceError =
    Math.abs(actualDistanceKm - targetDistanceKm) / targetDistanceKm;

  return { overlap, backtrack, spurM, spurShare, distanceError };
}

export function scoreLoopQuality(
  coordinates: [number, number][],
  targetDistanceKm: number,
  actualDistanceKm: number,
): number {
  const { overlap, backtrack, spurShare, distanceError } = loopQualityMetrics(
    coordinates,
    targetDistanceKm,
    actualDistanceKm,
  );

  return overlap * 2 + backtrack * 5 + spurShare * 6 + distanceError * 1.5;
}

export function isGoodLoopQuality(
  coordinates: [number, number][],
  targetDistanceKm: number,
  actualDistanceKm: number,
): boolean {
  const { overlap, backtrack, spurShare, distanceError } = loopQualityMetrics(
    coordinates,
    targetDistanceKm,
    actualDistanceKm,
  );

  return (
    overlap < 0.1 &&
    backtrack < 0.05 &&
    spurShare < 0.06 &&
    distanceError < 0.2
  );
}
