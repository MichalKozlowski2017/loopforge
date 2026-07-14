import type { RouteFeature, RouteMapGeoJson, LatLng } from "@loopforge/osm-types";

export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_000;
/** Matches generator approach styling — segments with this label are not part of the loop. */
const APPROACH_LABEL = "Dojazd";
/** Matches packages/generator/src/approach.ts APPROACH_COLOR. */
const APPROACH_COLOR = "#64748b";

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

function isApproachSegment(
  feature: RouteMapGeoJson["features"][number],
): boolean {
  const props = feature.properties;
  if (props.leg === "approach") return true;
  if (props.label === APPROACH_LABEL) return true;
  if (props.color === APPROACH_COLOR) return true;
  const dash = props.dash;
  if (
    Array.isArray(dash) &&
    dash.length === 2 &&
    dash[0] === 2 &&
    dash[1] === 2 &&
    props.category === "asphalt"
  ) {
    return true;
  }
  return false;
}

/** Loop-only coloured segments as shown on the map (excludes dojazd / powrót styling). */
function flattenLoopSegments(mapGeojson: RouteMapGeoJson): LngLat[] {
  const loopFeatures = mapGeojson.features.filter((f) => !isApproachSegment(f));
  if (loopFeatures.length === 0) return [];

  return concatSegments(
    loopFeatures.map((feature) => normalizeCoords(feature.geometry.coordinates)),
  );
}

function findNearestCoordIndex(coords: LngLat[], point: LngLat): number {
  let bestIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineMeters(coords[i]!, point);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function cumulativeDistances(coords: LngLat[]): number[] {
  const dist = [0];
  for (let i = 1; i < coords.length; i++) {
    dist.push(dist[i - 1]! + haversineMeters(coords[i - 1]!, coords[i]!));
  }
  return dist;
}

function findIndexNearPathDistanceM(
  coords: LngLat[],
  targetM: number,
  toleranceRatio = 0.2,
): number | null {
  if (coords.length < 2 || targetM <= 0) return null;

  const cumDist = cumulativeDistances(coords);
  const total = cumDist[cumDist.length - 1] ?? 0;
  if (total <= 0) return null;

  const toleranceM = Math.max(250, targetM * toleranceRatio);
  let bestIdx: number | null = null;
  let bestDiff = Infinity;

  for (let i = 0; i < coords.length; i++) {
    const diff = Math.abs((cumDist[i] ?? 0) - targetM);
    if (diff <= toleranceM && diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/** First point far enough from home that sits on the loop-entry junction. */
function findLoopEntryIndex(
  coords: LngLat[],
  loopEntry: LatLng,
  approachDistanceKm?: number | null,
): number {
  if (coords.length === 0) return 0;

  const entryPoint: LngLat = [loopEntry.lng, loopEntry.lat];
  const home = coords[0]!;
  const matchM = 95;
  const minTravelFromHomeM = 280;

  let firstNearEntry = -1;
  for (let i = 1; i < coords.length; i++) {
    if (haversineMeters(coords[i]!, home) < minTravelFromHomeM) continue;
    if (haversineMeters(coords[i]!, entryPoint) <= matchM) {
      firstNearEntry = i;
      break;
    }
  }

  const byDistance =
    approachDistanceKm != null && approachDistanceKm > 0
      ? findIndexNearPathDistanceM(coords, approachDistanceKm * 1000)
      : null;

  if (firstNearEntry >= 0 && byDistance != null) {
    const distAtFirst = haversineMeters(coords[firstNearEntry]!, entryPoint);
    const distAtDistance = haversineMeters(coords[byDistance]!, entryPoint);
    return distAtDistance < distAtFirst ? byDistance : firstNearEntry;
  }

  if (firstNearEntry >= 0) return firstNearEntry;
  if (byDistance != null) return byDistance;
  return findNearestCoordIndex(coords, entryPoint);
}

function readApproachDistanceKm(route: RouteFeature | null): number | null {
  const raw = route?.properties?.approachDistanceKm;
  return typeof raw === "number" && raw > 0 ? raw : null;
}

function readReturnApproachDistanceKm(route: RouteFeature | null): number | null {
  const raw = route?.properties?.returnApproachDistanceKm;
  return typeof raw === "number" && raw > 0 ? raw : null;
}

function pathStartsNearHome(
  path: LngLat[],
  home: LngLat,
  loopEntry: LatLng,
): boolean {
  if (path.length === 0) return false;
  const entryPoint: LngLat = [loopEntry.lng, loopEntry.lat];
  const start = path[0]!;
  const dHome = haversineMeters(start, home);
  const dEntry = haversineMeters(start, entryPoint);
  return dHome + 120 < dEntry;
}

/**
 * When mapGeojson lacks loop segments, slice the merged route LineString at loop
 * entry and before the homeward return leg.
 */
function extractLoopFromMergedRoute(
  coords: LngLat[],
  loopEntry: LatLng,
  route: RouteFeature | null,
): LngLat[] {
  if (coords.length < 2) return coords;

  const home = coords[0]!;
  const approachDistanceKm = readApproachDistanceKm(route);
  const returnApproachDistanceKm = readReturnApproachDistanceKm(route);
  const entryIdx = findLoopEntryIndex(coords, loopEntry, approachDistanceKm);

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
  if (returnApproachDistanceKm != null) {
    const totalM = cumulativeDistances(coords).at(-1) ?? 0;
    const returnStartM = Math.max(0, totalM - returnApproachDistanceKm * 1000);
    const returnByDistance = findIndexNearPathDistanceM(coords, returnStartM, 0.28);
    if (returnByDistance != null && returnByDistance > farthestIdx) {
      exitIdx = Math.max(entryIdx + 1, returnByDistance);
    }
  } else {
    for (let i = coords.length - 1; i > farthestIdx; i--) {
      const dHome = haversineMeters(coords[i]!, home);
      const dHomePrev = haversineMeters(coords[i - 1]!, home);
      if (dHome < dHomePrev - 30 && dHome < farthestFromHome * 0.75) {
        exitIdx = i - 1;
        break;
      }
    }
  }

  if (exitIdx <= entryIdx) {
    exitIdx = Math.max(entryIdx + 1, farthestIdx);
  }

  const loop = coords.slice(entryIdx, exitIdx + 1);
  if (loop.length >= 2) return loop;

  const fallbackEnd = Math.max(entryIdx + 1, coords.length - 1);
  return coords.slice(entryIdx, fallbackEnd + 1);
}

function approachEnabledForRoute(
  route: RouteFeature | null,
  approachEnabled?: boolean | null,
): boolean {
  if (approachEnabled != null) return approachEnabled;
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
  approachEnabled?: boolean | null,
  distanceHints?: {
    approachDistanceKm?: number | null;
    returnApproachDistanceKm?: number | null;
  },
): LngLat[] {
  const merged = route?.geometry.coordinates.length
    ? normalizeCoords(route.geometry.coordinates)
    : [];
  const hasApproach = approachEnabledForRoute(route, approachEnabled) && loopEntry;
  const home = merged[0] ?? null;
  const routeForSlice =
    distanceHints &&
    (distanceHints.approachDistanceKm != null ||
      distanceHints.returnApproachDistanceKm != null) &&
    route
      ? {
          ...route,
          properties: {
            ...route.properties,
            ...(distanceHints.approachDistanceKm != null
              ? { approachDistanceKm: distanceHints.approachDistanceKm }
              : {}),
            ...(distanceHints.returnApproachDistanceKm != null
              ? { returnApproachDistanceKm: distanceHints.returnApproachDistanceKm }
              : {}),
          },
        }
      : route;

  const loopFromMerged =
    hasApproach && loopEntry && merged.length >= 2
      ? extractLoopFromMergedRoute(merged, loopEntry, routeForSlice)
      : null;

  // With dojazd, always slice the merged LineString — mapGeojson tagging can vary
  // by bike profile / engine and must not decide whether the approach animates.
  if (loopFromMerged && loopFromMerged.length >= 2) {
    return loopFromMerged;
  }

  if (mapGeojson?.features.length) {
    const loopFromMap = flattenLoopSegments(mapGeojson);
    if (loopFromMap.length >= 2) {
      if (
        hasApproach &&
        loopEntry &&
        home &&
        pathStartsNearHome(loopFromMap, home, loopEntry) &&
        loopFromMerged &&
        loopFromMerged.length >= 2
      ) {
        return loopFromMerged;
      }
      return loopFromMap;
    }
  }

  if (merged.length < 2) return merged;
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

/** Shared map-fit config so every fitBounds/cameraForBounds call frames the loop identically. */
export const ROUTE_FIT_PADDING = { top: 24, bottom: 24, left: 24, right: 24 };
export const ROUTE_FIT_MAX_ZOOM = 15;

export function boundsOf(coords: LngLat[]): [LngLat, LngLat] | null {
  if (coords.length === 0) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
