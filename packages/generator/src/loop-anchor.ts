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

export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
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

/** Guide approach along the direction corridor instead of a single air-line snap. */
export function buildApproachCorridorWaypoints(
  home: LatLng,
  entryTarget: LatLng,
): LatLng[] {
  const totalM = haversineM(home, entryTarget);
  if (totalM < 3_200) return [];

  const bearing = bearingDeg(home, entryTarget);
  const fractions =
    totalM > 9_000 ? [0.32, 0.58, 0.82] : totalM > 5_500 ? [0.4, 0.72] : [0.52];

  return fractions.map((fraction) =>
    destinationPoint(home, bearing, totalM * fraction),
  );
}
