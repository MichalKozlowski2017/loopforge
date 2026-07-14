import type { RouteFeature, RouteMapGeoJson, LatLng } from "@loopforge/osm-types";

export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_000;
/** Matches generator approach styling — segments with this label are not part of the loop. */
const APPROACH_LABEL = "Dojazd";

function haversineMeters(a: LngLat, b: LngLat): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function normalizeCoords(coords: number[][]): LngLat[] {
  return coords
    .map((coord) => [coord[0], coord[1]] as LngLat)
    .filter(
      ([lng, lat]) =>
        Number.isFinite(lng) &&
        Number.isFinite(lat) &&
        Math.abs(lat) <= 90 &&
        !(lng === 0 && lat === 0),
    );
}

function concatSegments(segments: LngLat[][]): LngLat[] {
  const coords: LngLat[] = [];
  for (const segment of segments) {
    if (segment.length === 0) continue;
    if (coords.length === 0) {
      coords.push(...segment);
      continue;
    }
    const last = coords[coords.length - 1]!;
    const first = segment[0]!;
    if (last[0] === first[0] && last[1] === first[1]) {
      coords.push(...segment.slice(1));
    } else {
      coords.push(...segment);
    }
  }
  return coords;
}

function isApproachSegment(feature: RouteMapGeoJson["features"][number]): boolean {
  return feature.properties.label === APPROACH_LABEL;
}

/** Loop-only coloured segments as shown on the map (excludes dojazd / powrót styling). */
function flattenLoopSegments(mapGeojson: RouteMapGeoJson): LngLat[] {
  const loopFeatures = mapGeojson.features.filter((f) => !isApproachSegment(f));
  if (loopFeatures.length === 0) return [];

  return concatSegments(
    loopFeatures.map((feature) => normalizeCoords(feature.geometry.coordinates)),
  );
}

/**
 * When mapGeojson lacks loop segments, slice the merged route LineString at loop
 * entry and before the homeward return leg.
 */
function extractLoopFromMergedRoute(
  coords: LngLat[],
  loopEntry: LatLng,
): LngLat[] {
  if (coords.length < 2) return coords;

  const entryPoint: LngLat = [loopEntry.lng, loopEntry.lat];
  const home = coords[0]!;

  let entryIdx = 0;
  let bestEntryD = Infinity;
  let traveledM = 0;
  for (let i = 1; i < coords.length; i++) {
    traveledM += haversineMeters(coords[i - 1]!, coords[i]!);
    if (traveledM < 150) continue;
    const d = haversineMeters(coords[i]!, entryPoint);
    if (d < bestEntryD) {
      bestEntryD = d;
      entryIdx = i;
    }
  }

  let farthestIdx = entryIdx;
  let farthestFromHome = haversineMeters(coords[entryIdx]!, home);
  for (let i = entryIdx + 1; i < coords.length; i++) {
    const d = haversineMeters(coords[i]!, home);
    if (d > farthestFromHome) {
      farthestFromHome = d;
      farthestIdx = i;
    }
  }

  let exitIdx = coords.length - 1;
  for (let i = coords.length - 1; i > farthestIdx; i--) {
    const dHome = haversineMeters(coords[i]!, home);
    const dHomePrev = haversineMeters(coords[i - 1]!, home);
    if (dHome < dHomePrev - 30 && dHome < farthestFromHome * 0.75) {
      exitIdx = i - 1;
      break;
    }
  }

  if (exitIdx <= entryIdx) {
    exitIdx = Math.max(entryIdx + 1, farthestIdx);
  }

  return coords.slice(entryIdx, exitIdx + 1);
}

function approachEnabledOnRoute(route: RouteFeature | null): boolean {
  if (!route?.properties) return false;
  return Boolean(route.properties.approachEnabled);
}

/**
 * Path for the draw animation: loop only, matching the coloured loop segments on
 * the map (not the dojazd / powrót legs).
 */
export function flattenLoopDrawPath(
  route: RouteFeature | null,
  mapGeojson: RouteMapGeoJson | null,
  loopEntry?: LatLng | null,
): LngLat[] {
  if (mapGeojson?.features.length) {
    const loopFromMap = flattenLoopSegments(mapGeojson);
    if (loopFromMap.length >= 2) return loopFromMap;
  }

  const merged = route?.geometry.coordinates.length
    ? normalizeCoords(route.geometry.coordinates)
    : [];

  if (merged.length < 2) return merged;

  if (approachEnabledOnRoute(route) && loopEntry) {
    const loopOnly = extractLoopFromMergedRoute(merged, loopEntry);
    if (loopOnly.length >= 2) return loopOnly;
  }

  return merged;
}

/** Full travel path (approach + loop + return) for fitting the map viewport. */
export function flattenFullRoutePath(
  route: RouteFeature | null,
  mapGeojson: RouteMapGeoJson | null,
): LngLat[] {
  if (route?.geometry.coordinates.length) {
    return normalizeCoords(route.geometry.coordinates);
  }

  if (mapGeojson?.features.length) {
    return concatSegments(
      mapGeojson.features.map((feature) =>
        normalizeCoords(feature.geometry.coordinates),
      ),
    );
  }

  return [];
}

function cumulativeDistances(coords: LngLat[]): number[] {
  const dist = [0];
  for (let i = 1; i < coords.length; i++) {
    dist.push(dist[i - 1]! + haversineMeters(coords[i - 1]!, coords[i]!));
  }
  return dist;
}

/** Slice the path at a 0–1 progress along its total length. */
export function slicePathByProgress(
  coords: LngLat[],
  progress: number,
): { path: LngLat[]; tip: LngLat | null } {
  if (coords.length === 0) return { path: [], tip: null };
  if (coords.length === 1) {
    return { path: [coords[0]!], tip: coords[0]! };
  }

  const p = Math.max(0, Math.min(1, progress));
  if (p <= 0) return { path: [coords[0]!], tip: coords[0]! };
  if (p >= 1) {
    return { path: coords, tip: coords[coords.length - 1]! };
  }

  const cumDist = cumulativeDistances(coords);
  const total = cumDist[cumDist.length - 1]!;
  if (total <= 0) return { path: [coords[0]!], tip: coords[0]! };

  const target = total * p;
  let segmentIndex = cumDist.findIndex((d) => d >= target);
  if (segmentIndex <= 0) segmentIndex = 1;

  const segStart = cumDist[segmentIndex - 1]!;
  const segEnd = cumDist[segmentIndex]!;
  const segLen = segEnd - segStart;
  const t = segLen > 0 ? (target - segStart) / segLen : 0;

  const a = coords[segmentIndex - 1]!;
  const b = coords[segmentIndex]!;
  const tip: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  const path = coords.slice(0, segmentIndex);
  path.push(tip);
  return { path, tip };
}

/** Duration scales with path complexity — slow enough to read the draw. */
export function revealDurationMs(coords: LngLat[]): number {
  return Math.min(4800, Math.max(2400, coords.length * 10));
}
