import type { Direction, LatLng, RideProfileLoopPrefs } from "@loopforge/osm-types";
import { profileSurfaceMismatch } from "@loopforge/osm-types";
import { PREFER_APPROACH_OVERLAP_BELOW } from "./approach";

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

const VARIANT_SCALES = [
  1.0, 0.9, 1.1, 0.85, 1.15, 0.92, 1.08, 0.88, 1.12, 0.95, 1.05, 0.87, 1.13,
  0.93, 1.07, 1.0,
];
const VARIANT_POINT_COUNTS = [5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4];
const VARIANT_ROTATIONS = [
  0, 6, -6, 10, -10, 4, -4, 8, -8, 12, -12, 3, -3, 14, -14, 0,
];

/** Minimum target distance where an arc/ellipse loop is preferred. */
export const MIN_KM_FOR_ARC_LOOP = 18;

export type LoopShape = "arc" | "longitudinal";

/** Per-request randomness so repeated params produce different loops. */
export interface GenerationJitter {
  bearingDeg: number;
  scaleBias: number;
  variantOrder: number[];
  corridorOffsetDeg: number;
}

export function createGenerationJitter(variantCount = 5): GenerationJitter {
  const variantOrder = Array.from({ length: variantCount }, (_, i) => i);
  for (let i = variantCount - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [variantOrder[i], variantOrder[j]] = [variantOrder[j], variantOrder[i]];
  }
  return {
    bearingDeg: (Math.random() - 0.5) * 18,
    scaleBias: 0.92 + Math.random() * 0.16,
    variantOrder,
    corridorOffsetDeg: (Math.random() - 0.5) * 24,
  };
}

/** Shape order per variant — profile can bias arc vs longitudinal. */
export function loopShapeForVariant(
  distanceKm: number,
  variant: number,
  profilePrefs?: RideProfileLoopPrefs,
): LoopShape {
  const preferArc = distanceKm >= MIN_KM_FOR_ARC_LOOP;
  const even = variant % 2 === 0;

  if (profilePrefs?.shapeBias === "arc" && preferArc) {
    return even ? "arc" : "longitudinal";
  }
  if (profilePrefs?.shapeBias === "longitudinal") {
    return even ? "longitudinal" : "arc";
  }

  return preferArc
    ? even
      ? "arc"
      : "longitudinal"
    : even
      ? "longitudinal"
      : "arc";
}

/** Estimate routed length for waypoints placed on a forward-facing arc. */
function arcPathFactor(pointCount: number, arcSpanDeg: number): number {
  const halfStepRad = toRadians(arcSpanDeg / (2 * (pointCount - 1 || 1)));
  return pointCount <= 1
    ? 2
    : 2 + (pointCount - 1) * 2 * Math.sin(halfStepRad);
}

/** Arc / ellipse loop — works best when there is enough distance for a wide loop. */
export function buildArcLoopWaypoints(
  start: LatLng,
  distanceKm: number,
  direction: Direction,
  variant: number,
  scaleMultiplier = 1,
  avoidAsphalt = false,
  jitter?: GenerationJitter,
  profilePrefs?: RideProfileLoopPrefs,
): LatLng[] {
  const prefs = profilePrefs;
  const baseBearing = DIRECTION_BEARING[direction];
  const idx = variant % VARIANT_POINT_COUNTS.length;
  const basePointCount = avoidAsphalt
    ? 3 + (idx % 2)
    : VARIANT_POINT_COUNTS[idx];
  const pointCount = Math.max(
    2,
    Math.min(6, basePointCount + (prefs?.pointCountAdjust ?? 0)),
  );
  const scale =
    VARIANT_SCALES[idx] * scaleMultiplier * (jitter?.scaleBias ?? 1);
  const rotation = VARIANT_ROTATIONS[idx] + (jitter?.bearingDeg ?? 0) * 0.35;

  const baseArcHalfWidth = avoidAsphalt
    ? 32 + (idx % 3) * 5
    : 48 + (idx % 3) * 7;
  const arcHalfWidth = Math.max(
    22,
    baseArcHalfWidth + (prefs?.arcWidthExtraDeg ?? 0),
  );
  const arcSpanDeg = arcHalfWidth * 2;
  const arcStart = baseBearing - arcHalfWidth + rotation * 0.12;

  const baseDetour = avoidAsphalt
    ? 1.72 + Math.min(0.65, distanceKm / 75)
    : 1.42;
  const roadDetourFactor =
    baseDetour * (prefs?.detourMultiplier ?? 1);
  const pathFactor = arcPathFactor(pointCount, arcSpanDeg);
  const reachBoost = (avoidAsphalt ? 1.04 : 1) * (prefs?.reachBoost ?? 1);
  const radiusM =
    ((distanceKm * 1000 * reachBoost) / (pathFactor * roadDetourFactor)) * scale;

  const waypoints: LatLng[] = [];
  for (let i = 0; i < pointCount; i++) {
    const t = pointCount === 1 ? 0.5 : i / (pointCount - 1);
    const bearing = arcStart + t * arcSpanDeg;
    waypoints.push(destinationPoint(start, bearing, radiusM));
  }

  return waypoints;
}

/** Perpendicular bearing for a parallel return corridor (offset from the outbound line). */
function returnCorridorBearing(
  direction: Direction,
  variant: number,
  jitter?: GenerationJitter,
): number {
  const base = DIRECTION_BEARING[direction];
  const offset = jitter?.corridorOffsetDeg ?? 0;
  const side = variant % 2 === 0 ? -1 : 1;
  return (base + 90 * side + offset + 360) % 360;
}

function pointOnAxisOffset(
  start: LatLng,
  bearing: number,
  axisDistM: number,
  perpBearing: number,
  lateralM: number,
): LatLng {
  const onAxis = destinationPoint(start, bearing, axisDistM);
  return destinationPoint(onAxis, perpBearing, lateralM);
}

/** Estimate routed length for the longitudinal out + parallel return pattern. */
function longitudinalPathFactor(
  outCount: number,
  returnCount: number,
  outShare: number,
  lateralShare: number,
): number {
  const outLeg = outShare;
  const lateral = lateralShare;
  const returnLeg = Math.max(0.12, 1 - outShare - lateral * returnCount * 0.35);
  const connectors =
    Math.hypot(lateral, outLeg * 0.25) +
    (returnCount > 1 ? Math.hypot(lateral * 0.35, outLeg * 0.18) : 0);
  return outLeg + returnLeg + connectors;
}

/** Cone half-width (°) for direction coverage — tighter for diagonals. */
function directionConeHalfWidth(direction: Direction): number {
  switch (direction) {
    case "NW":
    case "NE":
    case "SW":
    case "SE":
      return 38;
    default:
      return 52;
  }
}

/** Fraction of route mileage inside a cone around `direction`. */
export function directionCoverageRatio(
  coordinates: [number, number][],
  start: LatLng,
  direction: Direction,
  halfWidthDeg = 90,
): number {
  if (coordinates.length < 2) return 0;

  const target = DIRECTION_BEARING[direction];
  let inSectorM = 0;
  let totalM = 0;

  for (let i = 1; i < coordinates.length; i++) {
    const a = { lng: coordinates[i - 1][0], lat: coordinates[i - 1][1] };
    const b = { lng: coordinates[i][0], lat: coordinates[i][1] };
    const segM = haversineM(a, b);
    if (segM < 5) continue;

    totalM += segM;
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    const bearing = bearingDeg(start, mid);
    const diff = Math.abs(((bearing - target + 540) % 360) - 180);
    if (diff <= halfWidthDeg) inSectorM += segM;
  }

  return totalM > 0 ? inSectorM / totalM : 0;
}

/**
 * Longitudinal loop: ride out in `direction`, return via a parallel corridor
 * so BRouter picks different roads (overlap/backtrack metrics guard same-road returns).
 */
export function buildLongitudinalLoopWaypoints(
  start: LatLng,
  distanceKm: number,
  direction: Direction,
  variant: number,
  scaleMultiplier = 1,
  avoidAsphalt = false,
  jitter?: GenerationJitter,
  profilePrefs?: RideProfileLoopPrefs,
): LatLng[] {
  const prefs = profilePrefs;
  const idx = variant % VARIANT_SCALES.length;
  const scale =
    VARIANT_SCALES[idx] * scaleMultiplier * (jitter?.scaleBias ?? 1);
  const bearing =
    (DIRECTION_BEARING[direction] +
      VARIANT_ROTATIONS[idx] * 0.35 +
      (jitter?.bearingDeg ?? 0) +
      360) %
    360;

  const baseOutCount = avoidAsphalt
    ? distanceKm >= 35
      ? 3 + (idx % 2)
      : 2 + (idx % 2)
    : 2 + (idx % 2);
  const outCount = Math.max(
    2,
    Math.min(5, baseOutCount + (prefs?.pointCountAdjust ?? 0)),
  );
  const returnCount = avoidAsphalt ? 1 + (idx % 2) : 1 + (idx % 2);
  const outShare = avoidAsphalt
    ? 0.46 + (idx % 3) * 0.022
    : 0.42 + (idx % 3) * 0.04;
  const baseLateral = avoidAsphalt
    ? 0.032 + (idx % 3) * 0.006
    : 0.07 + (idx % 4) * 0.015;
  const lateralShare = Math.max(
    0.018,
    baseLateral + (prefs?.lateralShareExtra ?? 0),
  );

  const baseDetour = avoidAsphalt
    ? 1.58 + Math.min(0.62, distanceKm / 75)
    : 1.38;
  const roadDetourFactor =
    baseDetour * (prefs?.detourMultiplier ?? 1);
  const pathFactor = longitudinalPathFactor(
    outCount,
    returnCount,
    outShare,
    lateralShare,
  );
  const totalM = ((distanceKm * 1000) / (pathFactor * roadDetourFactor)) * scale;
  const outDistM = totalM * outShare;
  const lateralM = totalM * lateralShare;
  const perpBearing = returnCorridorBearing(direction, idx, jitter);

  const waypoints: LatLng[] = [];

  for (let i = 0; i < outCount; i++) {
    const t = (i + 1) / outCount;
    waypoints.push(destinationPoint(start, bearing, outDistM * t));
  }

  for (let i = 0; i < returnCount; i++) {
    const backT = 1 - (i + 1) / (returnCount + 1.2);
    const lateralT = 1 - i * 0.22;
    waypoints.push(
      pointOnAxisOffset(
        start,
        bearing,
        outDistM * backT,
        perpBearing,
        lateralM * lateralT,
      ),
    );
  }

  return waypoints;
}

/** Shift planned loop away from the home→entry corridor (approach leg). */
export function shiftWaypointsAwayFromHome(
  waypoints: LatLng[],
  loopStart: LatLng,
  home: LatLng,
  variant: number,
): LatLng[] {
  if (waypoints.length === 0) return waypoints;

  const towardHome = bearingDeg(loopStart, home);
  const awayBearing = (towardHome + 90 + (variant % 2 === 0 ? 0 : 180)) % 360;
  const shiftM = 320 + (variant % 4) * 150;
  const shiftedOrigin = destinationPoint(loopStart, awayBearing, shiftM);

  return waypoints.map((wp) => {
    const distM = haversineM(loopStart, wp);
    const bearing = bearingDeg(loopStart, wp);
    return destinationPoint(shiftedOrigin, bearing, distM);
  });
}

export interface LoopWaypointExtras {
  /** Real start (home) — shifts loop plan away from the approach corridor. */
  homeStart?: LatLng;
}

/** Build waypoints for the requested loop shape. */
export function buildLoopWaypoints(
  start: LatLng,
  distanceKm: number,
  direction: Direction,
  variant: number,
  scaleMultiplier = 1,
  shape?: LoopShape,
  avoidAsphalt = false,
  jitter?: GenerationJitter,
  extras?: LoopWaypointExtras,
  profilePrefs?: RideProfileLoopPrefs,
): LatLng[] {
  const resolved = shape ?? loopShapeForVariant(distanceKm, variant, profilePrefs);
  const waypoints =
    resolved === "arc"
      ? buildArcLoopWaypoints(
          start,
          distanceKm,
          direction,
          variant,
          scaleMultiplier,
          avoidAsphalt,
          jitter,
          profilePrefs,
        )
      : buildLongitudinalLoopWaypoints(
          start,
          distanceKm,
          direction,
          variant,
          scaleMultiplier,
          avoidAsphalt,
          jitter,
          profilePrefs,
        );

  if (extras?.homeStart) {
    return shiftWaypointsAwayFromHome(
      waypoints,
      start,
      extras.homeStart,
      variant,
    );
  }

  return waypoints;
}

/** Score route quality; when avoiding asphalt, paved share drives shape choice. */
export function scoreLoopQualityWithShape(
  coordinates: [number, number][],
  targetDistanceKm: number,
  actualDistanceKm: number,
  shape: LoopShape,
  start?: LatLng,
  direction?: Direction,
  options?: {
    avoidAsphalt?: boolean;
    preferQuietRoutes?: boolean;
    pavedShare?: number;
    busyRoadShare?: number;
    offroadShare?: number;
    approachOverlap?: number;
    viaPointsMode?: boolean;
    profilePrefs?: RideProfileLoopPrefs;
  },
): number {
  const base = scoreLoopQuality(
    coordinates,
    targetDistanceKm,
    actualDistanceKm,
    start,
    direction,
  );

  const pavedShare = options?.pavedShare ?? 0;
  const approachOverlap = options?.approachOverlap ?? 0;
  const metrics = loopQualityMetrics(
    coordinates,
    targetDistanceKm,
    actualDistanceKm,
    start,
    direction,
  );

  const arcViable =
    metrics.overlap < 0.14 &&
    metrics.backtrack < 0.07 &&
    metrics.spurShare < 0.08 &&
    metrics.distanceError < 0.22 &&
    metrics.directionCoverage >= 0.45;

  let score = base;

  if (options?.profilePrefs && options.profilePrefs.surfaceMismatchWeight > 0) {
    score += profileSurfaceMismatch(
      pavedShare,
      options.offroadShare ?? 0,
      options.profilePrefs,
    );
  }

  if (options?.avoidAsphalt) {
    score += pavedShare * 16;
    score += Math.max(0, pavedShare - 0.28) ** 2 * 40;
    score += metrics.distanceError * 28;
  }

  if (options?.preferQuietRoutes) {
    const busyShare = options.busyRoadShare ?? 0;
    score += busyShare * 22;
    score += Math.max(0, busyShare - 0.12) ** 2 * 70;
  }

  if (options?.viaPointsMode) {
    score += metrics.distanceError * 22;
  }

  if (approachOverlap > 0) {
    score += approachOverlap * 28;
    if (approachOverlap > PREFER_APPROACH_OVERLAP_BELOW) {
      score += (approachOverlap - PREFER_APPROACH_OVERLAP_BELOW) ** 2 * 80;
    }
  }

  if (shape === "arc" && arcViable) {
    if (options?.avoidAsphalt) {
      if (pavedShare < 0.3) score -= 0.4;
      else if (pavedShare < 0.38) score -= 0.22;
      else if (pavedShare < 0.48) score -= 0.08;
    } else {
      score -= 0.2;
    }
  }

  return score;
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
  start?: LatLng,
  direction?: Direction,
) {
  const overlap = overlapRatio(coordinates);
  const backtrack = backtrackRatio(coordinates);
  const spurM = spurLengthM(coordinates);
  const spurShare =
    actualDistanceKm > 0 ? spurM / (actualDistanceKm * 1000) : 0;
  const distanceError =
    Math.abs(actualDistanceKm - targetDistanceKm) / targetDistanceKm;
  const directionCoverage =
    start && direction
      ? directionCoverageRatio(
          coordinates,
          start,
          direction,
          directionConeHalfWidth(direction),
        )
      : 1;

  return {
    overlap,
    backtrack,
    spurM,
    spurShare,
    distanceError,
    directionCoverage,
  };
}

export function scoreLoopQuality(
  coordinates: [number, number][],
  targetDistanceKm: number,
  actualDistanceKm: number,
  start?: LatLng,
  direction?: Direction,
): number {
  const { overlap, backtrack, spurShare, distanceError, directionCoverage } =
    loopQualityMetrics(
      coordinates,
      targetDistanceKm,
      actualDistanceKm,
      start,
      direction,
    );

  const directionPenalty = Math.max(0, 0.55 - directionCoverage) * 24;

  return (
    overlap * 2.5 +
    backtrack * 14 +
    spurShare * 22 +
    distanceError * 10 +
    directionPenalty
  );
}

export function isGoodLoopQuality(
  coordinates: [number, number][],
  targetDistanceKm: number,
  actualDistanceKm: number,
  start?: LatLng,
  direction?: Direction,
): boolean {
  const { overlap, backtrack, spurShare, distanceError, directionCoverage } =
    loopQualityMetrics(
      coordinates,
      targetDistanceKm,
      actualDistanceKm,
      start,
      direction,
    );

  return (
    overlap < 0.08 &&
    backtrack < 0.035 &&
    spurShare < 0.035 &&
    distanceError < 0.18 &&
    directionCoverage >= 0.48
  );
}
