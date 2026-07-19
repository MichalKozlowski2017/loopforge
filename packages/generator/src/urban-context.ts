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

export type GeometrySafetyLimits = {
  /** Max new edge when cutting a dead-end spur at a junction. */
  maxPruneStitchM: number;
  /** Global dense-polyline outlier check (metro-scale). */
  useDenseTeleportCheck: boolean;
  denseP95MaxM: number;
  denseOutlierMinM: number;
  absoluteTeleportM: number;
  /**
   * Always scan for long edges with short local neighbours — works on mixed
   * loops (open country + small town) where global p95 stays rural.
   */
  useLocalAirChordCheck: boolean;
  localAirChordMinM: number;
  localAirChordMedianMaxM: number;
  localAirChordRatio: number;
  /** Debug / logs: why this profile was chosen. */
  source: "metro" | "dense-town" | "mixed" | "open-country";
};

const METRO_GEOMETRY_LIMITS: GeometrySafetyLimits = {
  maxPruneStitchM: 100,
  useDenseTeleportCheck: true,
  denseP95MaxM: 32,
  denseOutlierMinM: 110,
  absoluteTeleportM: 1200,
  useLocalAirChordCheck: true,
  localAirChordMinM: 95,
  localAirChordMedianMaxM: 34,
  localAirChordRatio: 5,
  source: "metro",
};

/** Small town / mixed fabric (e.g. Dzielce → through Tłuszcz). */
const MIXED_GEOMETRY_LIMITS: GeometrySafetyLimits = {
  maxPruneStitchM: 90,
  useDenseTeleportCheck: true,
  denseP95MaxM: 36,
  denseOutlierMinM: 105,
  absoluteTeleportM: 1200,
  useLocalAirChordCheck: true,
  localAirChordMinM: 90,
  localAirChordMedianMaxM: 36,
  localAirChordRatio: 4.5,
  source: "mixed",
};

const OPEN_COUNTRY_GEOMETRY_LIMITS: GeometrySafetyLimits = {
  maxPruneStitchM: 70,
  useDenseTeleportCheck: false,
  denseP95MaxM: 0,
  denseOutlierMinM: Number.POSITIVE_INFINITY,
  absoluteTeleportM: 1200,
  useLocalAirChordCheck: true,
  localAirChordMinM: 110,
  localAirChordMedianMaxM: 40,
  localAirChordRatio: 5.5,
  source: "open-country",
};

/** Binary preset when only the start point is known (pre-route). */
export function geometrySafetyLimits(urban: boolean): GeometrySafetyLimits {
  return urban
    ? { ...METRO_GEOMETRY_LIMITS, source: "metro" }
    : { ...OPEN_COUNTRY_GEOMETRY_LIMITS, source: "open-country" };
}

function pointInMetroArea(lat: number, lng: number): boolean {
  return METRO_BBOXES.some(
    (box) =>
      lat >= box.minLat &&
      lat <= box.maxLat &&
      lng >= box.minLng &&
      lng <= box.maxLng,
  );
}

/** Share of route vertices that fall inside a known metro bbox. */
export function metroShareOfCoordinates(
  coordinates: Array<[number, number]>,
): number {
  if (coordinates.length === 0) return 0;
  let inside = 0;
  for (const [lng, lat] of coordinates) {
    if (pointInMetroArea(lat, lng)) inside += 1;
  }
  return inside / coordinates.length;
}

function haversineEdgeM(
  a: [number, number],
  b: [number, number],
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function routeEdgeLengthStats(
  coordinates: Array<[number, number]>,
): { medianM: number; p95M: number; denseEdgeShare: number } {
  if (coordinates.length < 2) {
    return { medianM: 0, p95M: 0, denseEdgeShare: 0 };
  }
  const edges: number[] = [];
  for (let i = 1; i < coordinates.length; i++) {
    edges.push(haversineEdgeM(coordinates[i - 1]!, coordinates[i]!));
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const medianM = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95M = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  const denseEdgeShare =
    edges.length > 0
      ? edges.filter((m) => m > 0 && m < 35).length / edges.length
      : 0;
  return { medianM, p95M, denseEdgeShare };
}

/**
 * Infer geometry budgets from the actual polyline (+ optional start).
 * Handles metro, small-town density (Tłuszcz-class), mixed loops, and open country.
 */
export function inferGeometrySafetyLimits(
  coordinates: Array<[number, number]>,
  start?: LatLng,
): GeometrySafetyLimits {
  const startUrban = start ? startInMetroArea(start) : false;
  const metroShare =
    coordinates.length >= 8 ? metroShareOfCoordinates(coordinates) : 0;
  const { medianM, p95M, denseEdgeShare } = routeEdgeLengthStats(coordinates);

  if (startUrban || metroShare >= 0.22) {
    return { ...METRO_GEOMETRY_LIMITS, source: "metro" };
  }

  // Dense street fabric even outside our metro bboxes (powiat towns).
  if (
    coordinates.length >= 40 &&
    denseEdgeShare >= 0.5 &&
    medianM > 0 &&
    medianM <= 28 &&
    p95M <= 45
  ) {
    return {
      ...MIXED_GEOMETRY_LIMITS,
      maxPruneStitchM: 100,
      source: "dense-town",
    };
  }

  // Mixed: meaningful dense share plus open legs (Dzielce ↔ Tłuszcz).
  if (
    coordinates.length >= 40 &&
    denseEdgeShare >= 0.28 &&
    denseEdgeShare < 0.5
  ) {
    return { ...MIXED_GEOMETRY_LIMITS, source: "mixed" };
  }

  if (
    coordinates.length >= 40 &&
    denseEdgeShare >= 0.5 &&
    (medianM > 28 || p95M > 45)
  ) {
    // Dense but with longer edges — still treat as mixed town fabric.
    return { ...MIXED_GEOMETRY_LIMITS, source: "mixed" };
  }

  return { ...OPEN_COUNTRY_GEOMETRY_LIMITS, source: "open-country" };
}
