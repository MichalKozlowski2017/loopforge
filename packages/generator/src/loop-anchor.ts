import type { Direction, LatLng } from "@loopforge/osm-types";

const EARTH_RADIUS_M = 6_371_000;

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

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

function destinationPoint(
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

export function loopEntryOffsetM(loopDistanceKm: number): number {
  return Math.round(
    Math.min(18_000, Math.max(4_000, loopDistanceKm * 160)),
  );
}

export function approachTargetOffsetM(
  loopDistanceKm: number,
  approachDistanceKm?: number,
): number {
  if (approachDistanceKm != null && approachDistanceKm > 0) {
    return Math.round(Math.min(40, Math.max(1, approachDistanceKm)) * 1000);
  }
  return loopEntryOffsetM(loopDistanceKm);
}

export function computeLoopEntryTarget(
  start: LatLng,
  direction: Direction,
  loopDistanceKm: number,
  approachDistanceKm?: number,
): LatLng {
  return destinationPoint(
    start,
    DIRECTION_BEARING[direction],
    approachTargetOffsetM(loopDistanceKm, approachDistanceKm),
  );
}
