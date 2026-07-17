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

export function maxAcceptableDistanceError(
  targetKm: number,
  relaxed: boolean,
  urban = true,
): number {
  let err: number;
  if (targetKm >= 45) err = relaxed ? 0.17 : 0.14;
  else if (targetKm >= 35) err = relaxed ? 0.19 : 0.16;
  else if (targetKm >= 25) err = relaxed ? 0.22 : 0.18;
  else err = relaxed ? 0.26 : 0.22;

  // Sparse rural networks often undershoot/overshoot more than metro grids.
  if (!urban) err += relaxed ? 0.06 : 0.04;
  return err;
}

/** Maximum routed loop length as a fraction of the requested distance. */
export function maxLoopShareOfTarget(
  targetKm: number,
  relaxed = false,
  urban = true,
): number {
  const err = maxAcceptableDistanceError(targetKm, relaxed, urban);
  return 1 + err;
}

/** Minimum routed loop length as a fraction of the requested distance. */
export function minLoopShareOfTarget(targetKm: number, urban = false): number {
  // Rural: allow more undershoot — gravel/dirt graphs are patchy.
  if (targetKm >= 40) return urban ? 0.8 : 0.7;
  if (targetKm >= 30) return urban ? 0.78 : 0.68;
  return urban ? 0.78 : 0.65;
}

export function urbanWaypointAdjustments(
  distanceKm: number,
  escalated: boolean,
  inMetro = false,
): Partial<RideProfileLoopPrefs> {
  // Never apply metro waypoint compression outside the city — it breaks rural loops.
  if (!inMetro) {
    return {};
  }
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

/** Urban routing prefs only when the start is inside a metro bbox — not by distance alone. */
export function useUrbanRouting(start: LatLng, _distanceKm?: number): boolean {
  return startInMetroArea(start);
}
