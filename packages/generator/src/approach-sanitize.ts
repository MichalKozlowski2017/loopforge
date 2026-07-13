import type { LatLng, OsmTags } from "@loopforge/osm-types";
import type { RoutedLeg } from "./approach";

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
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

function pathLengthM(coords: [number, number][]): number {
  let meters = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const dLat = toRadians(b[1] - a[1]);
    const dLng = toRadians(b[0] - a[0]);
    const lat1 = toRadians(a[1]);
    const lat2 = toRadians(b[1]);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    meters += 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
  }
  return meters;
}

function segmentBearing(a: [number, number], b: [number, number]): number {
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLng = toRadians(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function isCemeteryTagged(tags: OsmTags): boolean {
  if (tags.landuse === "cemetery" || tags.amenity === "grave_yard") return true;
  const name = (tags.name ?? "").toLowerCase();
  return name.includes("cmentarz") || name.includes("cemetery");
}

/** Share of approach distance on cemetery-tagged or internal service grid. */
export function cemeteryShortcutShare(
  segments: { tags: OsmTags; distanceM: number }[],
): number {
  let totalM = 0;
  let cemeteryM = 0;
  for (const segment of segments) {
    totalM += segment.distanceM;
    const tags = segment.tags;
    if (isCemeteryTagged(tags)) {
      cemeteryM += segment.distanceM;
      continue;
    }
    if (
      tags.highway === "service" &&
      (tags.service === "driveway" || tags.service === "parking_aisle")
    ) {
      cemeteryM += segment.distanceM * 0.6;
    }
  }
  return totalM > 0 ? cemeteryM / totalM : 0;
}

export function approachDetourRatio(
  approach: RoutedLeg,
  from: LatLng,
  to: LatLng,
): number {
  const airM = Math.max(200, haversineM(from, to));
  const pathM = pathLengthM(approach.coordinates);
  return pathM / airM;
}

/** Sharp turns typical of cemetery grid routing. */
export function sharpTurnCount(coordinates: [number, number][]): number {
  let count = 0;
  for (let i = 1; i < coordinates.length - 1; i++) {
    const b1 = segmentBearing(coordinates[i - 1]!, coordinates[i]!);
    const b2 = segmentBearing(coordinates[i]!, coordinates[i + 1]!);
    if (angularDiffDeg(b1, b2) >= 55) count++;
  }
  return count;
}

export function approachLooksLikeCemeteryDetour(
  approach: RoutedLeg,
  from: LatLng,
  to: LatLng,
): boolean {
  const cemeteryShare = cemeteryShortcutShare(approach.segments);
  const detour = approachDetourRatio(approach, from, to);
  const turns = sharpTurnCount(approach.coordinates);

  if (cemeteryShare >= 0.12) return true;
  if (detour >= 1.18 && cemeteryShare >= 0.04) return true;
  if (detour >= 1.12 && turns >= 4 && cemeteryShare >= 0.02) return true;
  return false;
}
