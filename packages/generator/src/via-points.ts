import type { Direction, LatLng } from "@loopforge/osm-types";
import {
  MAX_VIA_POINTS,
  type ViaPointRouteContext,
} from "./via-validation";
import {
  buildLoopWaypoints,
  type GenerationJitter,
  type LoopShape,
  type LoopWaypointExtras,
} from "./loop-waypoints";

export { MAX_VIA_POINTS } from "./via-validation";

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
const MIN_VIA_SEPARATION_M = 350;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
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

function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function directionOffset(loopStart: LatLng, direction: Direction, point: LatLng): number {
  return angularDiffDeg(bearingDeg(loopStart, point), DIRECTION_BEARING[direction]);
}

export function sortViaPointsAlongDirection(
  loopStart: LatLng,
  direction: Direction,
  points: LatLng[],
): LatLng[] {
  return [...points].sort(
    (a, b) => directionOffset(loopStart, direction, a) - directionOffset(loopStart, direction, b),
  );
}

/** Insert must-pass points into the auto loop plan by bearing (keeps full loop shape). */
export function mergeViasIntoAutoWaypoints(
  loopStart: LatLng,
  direction: Direction,
  auto: LatLng[],
  vias: LatLng[],
): LatLng[] {
  if (vias.length === 0) return auto;

  const merged = [...auto];
  const sorted = sortViaPointsAlongDirection(loopStart, direction, vias);

  for (const via of sorted) {
    const viaOffset = directionOffset(loopStart, direction, via);
    if (merged.some((p) => haversineM(p, via) < MIN_VIA_SEPARATION_M)) continue;

    let insertAt = merged.length;
    for (let i = 0; i < merged.length; i++) {
      if (viaOffset < directionOffset(loopStart, direction, merged[i]!)) {
        insertAt = i;
        break;
      }
    }
    merged.splice(insertAt, 0, via);
  }

  return merged;
}

/** Build routing waypoints, weaving user via points into the auto loop plan. */
export function buildLoopWaypointsWithVia(
  loopStart: LatLng,
  distanceKm: number,
  direction: Direction,
  variant: number,
  scaleMultiplier: number,
  shape: LoopShape,
  avoidAsphalt: boolean,
  jitter: GenerationJitter | undefined,
  viaPoints: LatLng[],
  extras?: LoopWaypointExtras,
): LatLng[] {
  const vias = viaPoints.slice(0, MAX_VIA_POINTS);
  const viaBoost = vias.length > 0 ? 1.06 : 1;
  const auto = buildLoopWaypoints(
    loopStart,
    distanceKm,
    direction,
    variant,
    scaleMultiplier * viaBoost,
    shape,
    avoidAsphalt,
    jitter,
    extras,
  );

  if (vias.length === 0) return auto;

  return mergeViasIntoAutoWaypoints(loopStart, direction, auto, vias);
}

export type { ViaPointRouteContext };
