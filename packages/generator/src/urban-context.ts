import type { LatLng, RideProfileLoopPrefs } from "@loopforge/osm-types";

/** Long loops from dense road grids need wider waypoint planning. */
export function prefersUrbanLoopTuning(distanceKm: number): boolean {
  return distanceKm >= 35;
}

/** First routing came back much shorter than target — escalate urban tuning. */
export function shouldEscalateUrbanTuning(
  targetKm: number,
  actualKm: number,
): boolean {
  return actualKm < targetKm * 0.82;
}

export function maxAcceptableDistanceError(targetKm: number, relaxed: boolean): number {
  if (targetKm >= 45) return relaxed ? 0.17 : 0.14;
  if (targetKm >= 35) return relaxed ? 0.19 : 0.16;
  if (targetKm >= 25) return relaxed ? 0.22 : 0.18;
  return relaxed ? 0.26 : 0.22;
}

/** Minimum routed loop length as a fraction of the requested distance. */
export function minLoopShareOfTarget(targetKm: number, urban = false): number {
  if (targetKm >= 40) return urban ? 0.8 : 0.85;
  if (targetKm >= 30) return urban ? 0.78 : 0.82;
  return 0.78;
}

export function urbanWaypointAdjustments(
  distanceKm: number,
  escalated: boolean,
): Partial<RideProfileLoopPrefs> {
  if (!prefersUrbanLoopTuning(distanceKm) && !escalated) {
    return {};
  }

  return {
    detourMultiplier: escalated ? 0.7 : 0.8,
    arcWidthExtraDeg: escalated ? 12 : 8,
    lateralShareExtra: escalated ? 0.022 : 0.014,
    pointCountAdjust: escalated ? 2 : 1,
    reachBoost: escalated ? 1.08 : 1.05,
  };
}

export function mergeLoopPrefs(
  base: RideProfileLoopPrefs,
  urban: Partial<RideProfileLoopPrefs>,
): RideProfileLoopPrefs {
  if (Object.keys(urban).length === 0) return base;

  return {
    ...base,
    detourMultiplier: base.detourMultiplier * (urban.detourMultiplier ?? 1),
    arcWidthExtraDeg: base.arcWidthExtraDeg + (urban.arcWidthExtraDeg ?? 0),
    lateralShareExtra: base.lateralShareExtra + (urban.lateralShareExtra ?? 0),
    pointCountAdjust: base.pointCountAdjust + (urban.pointCountAdjust ?? 0),
    reachBoost: base.reachBoost * (urban.reachBoost ?? 1),
  };
}

/** Large Polish metro bounding boxes (approx.) — boost urban tuning at start. */
const METRO_BBOXES: Array<{ name: string; minLat: number; maxLat: number; minLng: number; maxLng: number }> = [
  { name: "Warszawa", minLat: 52.05, maxLat: 52.45, minLng: 20.75, maxLng: 21.25 },
  { name: "Kraków", minLat: 49.95, maxLat: 50.15, minLng: 19.75, maxLng: 20.15 },
  { name: "Trójmiasto", minLat: 54.25, maxLat: 54.55, minLng: 18.4, maxLng: 18.85 },
  { name: "Wrocław", minLat: 51.0, maxLat: 51.2, minLng: 16.85, maxLng: 17.2 },
  { name: "Poznań", minLat: 52.3, maxLat: 52.5, minLng: 16.75, maxLng: 17.05 },
  { name: "Łódź", minLat: 51.65, maxLat: 51.85, minLng: 19.35, maxLng: 19.6 },
  { name: "Katowice", minLat: 50.2, maxLat: 50.35, minLng: 18.95, maxLng: 19.25 },
];

export function startInMetroArea(start: LatLng): boolean {
  return METRO_BBOXES.some(
    (box) =>
      start.lat >= box.minLat &&
      start.lat <= box.maxLat &&
      start.lng >= box.minLng &&
      start.lng <= box.maxLng,
  );
}

export function useUrbanRouting(start: LatLng, distanceKm: number): boolean {
  return prefersUrbanLoopTuning(distanceKm) || startInMetroArea(start);
}
