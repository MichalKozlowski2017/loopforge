import type { RouteMapGeoJson } from "@loopforge/osm-types";

type Coord = [number, number];
type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toLatLng(coord: Coord): LatLng {
  return { lng: coord[0], lat: coord[1] };
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

function pathLengthM(coordinates: Coord[], fromIndex: number, toIndex: number): number {
  let meters = 0;
  const start = Math.max(0, fromIndex);
  const end = Math.min(toIndex, coordinates.length - 1);
  for (let i = start; i < end; i++) {
    meters += haversineM(toLatLng(coordinates[i]), toLatLng(coordinates[i + 1]));
  }
  return meters;
}

function totalPathLengthM(coordinates: Coord[]): number {
  return pathLengthM(coordinates, 0, coordinates.length - 1);
}

export interface SpurRange {
  /** First index to remove (inclusive). */
  start: number;
  /** Last index to remove (inclusive). */
  end: number;
}

interface SpurDetectConfig {
  matchM: number;
  minSpurM: number;
  minGap: number;
  maxSpanRatio: number;
  minDetourRatio: number;
  midBulgeRatio: number;
  maxMidBulgeM: number;
}

const DEFAULT_SPUR_CONFIG: SpurDetectConfig = {
  matchM: 65,
  minSpurM: 22,
  minGap: 6,
  maxSpanRatio: 0.62,
  minDetourRatio: 1.18,
  midBulgeRatio: 0.26,
  maxMidBulgeM: 95,
};

const MICRO_SPUR_CONFIG: SpurDetectConfig = {
  matchM: 26,
  minSpurM: 12,
  minGap: 4,
  maxSpanRatio: 0.4,
  minDetourRatio: 1.18,
  midBulgeRatio: 0.22,
  maxMidBulgeM: 45,
};

function findDeadEndSpurRangesWithConfig(
  coordinates: Coord[],
  config: SpurDetectConfig,
): SpurRange[] {
  if (coordinates.length < 12) return [];

  const ranges: SpurRange[] = [];
  const maxSpan = Math.floor(coordinates.length * config.maxSpanRatio);
  const totalM = totalPathLengthM(coordinates);
  const maxSpurM = Math.max(2500, totalM * 0.28);

  for (let i = 0; i < coordinates.length - config.minGap; i++) {
    const origin = toLatLng(coordinates[i]);

    for (let j = i + config.minGap; j < coordinates.length; j++) {
      if (j - i > maxSpan) break;

      const returnPt = toLatLng(coordinates[j]);
      if (haversineM(origin, returnPt) > config.matchM) continue;

      const spurPathM = pathLengthM(coordinates, i, j);
      if (spurPathM < config.minSpurM) continue;
      if (spurPathM > maxSpurM) continue;

      // Loop closure near start/end is the main route, not a dead-end spur.
      if (i < 3 && j > coordinates.length * 0.45) continue;
      if (j >= coordinates.length - 4 && i < coordinates.length * 0.12) {
        continue;
      }

      const straightM = Math.max(haversineM(origin, returnPt), 1);
      if (spurPathM / straightM < config.minDetourRatio) continue;

      const mid = Math.floor((i + j) / 2);
      const midPt = toLatLng(coordinates[mid]);
      if (
        haversineM(origin, midPt) <
        Math.min(spurPathM * config.midBulgeRatio, config.maxMidBulgeM)
      ) {
        continue;
      }

      ranges.push({ start: i + 1, end: j - 1 });
      break;
    }
  }

  return mergeSpurRanges(ranges);
}

/**
 * Find out-and-back dead-end spurs: path leaves a point and returns to ~same spot
 * after a detour (cul-de-sac, service road, path stub).
 */
export function findDeadEndSpurRanges(coordinates: Coord[]): SpurRange[] {
  return findDeadEndSpurRangesWithConfig(coordinates, DEFAULT_SPUR_CONFIG);
}

/** Small jogs into side streets / field tracks (10–80 m). */
export function findMicroSpurRanges(coordinates: Coord[]): SpurRange[] {
  return findDeadEndSpurRangesWithConfig(coordinates, MICRO_SPUR_CONFIG);
}

function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function bearingDelta(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function vertexTurnDeg(coordinates: Coord[], index: number): number {
  if (index <= 0 || index >= coordinates.length - 1) return 0;
  const inBearing = bearingDeg(
    toLatLng(coordinates[index - 1]!),
    toLatLng(coordinates[index]!),
  );
  const outBearing = bearingDeg(
    toLatLng(coordinates[index]!),
    toLatLng(coordinates[index + 1]!),
  );
  return bearingDelta(inBearing, outBearing);
}

/**
 * Short branch off the main corridor on an open route (approach leg): sharp turn,
 * out-and-back to the same junction without enough detour for the loop spur heuristics.
 */
export function findOpenPathBranchStubRanges(coordinates: Coord[]): SpurRange[] {
  if (coordinates.length < 5) return [];

  const ranges: SpurRange[] = [];
  const maxStubM = 420;
  const minStubM = 8;
  const rejoinM = 44;
  const minTurnDeg = 22;
  const endReserve = 12;

  for (let j = 1; j < coordinates.length - 2; j++) {
    if (j >= coordinates.length - endReserve) continue;
    if (vertexTurnDeg(coordinates, j) < minTurnDeg) continue;

    const junction = toLatLng(coordinates[j]!);

    for (let k = j + 2; k < coordinates.length; k++) {
      const stubM = pathLengthM(coordinates, j, k);
      if (stubM > maxStubM) break;

      const distFromJunction = haversineM(junction, toLatLng(coordinates[k]!));
      if (distFromJunction > rejoinM) continue;
      if (stubM < minStubM) continue;

      ranges.push({ start: j + 1, end: k - 1 });
      break;
    }
  }

  return mergeSpurRanges(ranges);
}

/** Sharp hairpin at a dead-end tip (route turns ~180° within a short stub). */
export function findHairpinSpurRanges(coordinates: Coord[]): SpurRange[] {
  if (coordinates.length < 10) return [];

  const ranges: SpurRange[] = [];
  const maxStubM = 130;
  const minStubM = 14;
  const tipWindow = 6;

  for (let i = 0; i < coordinates.length - 8; i++) {
    let distM = 0;
    let tipIndex = i + 1;
    let maxDistFromStart = 0;

    for (let k = i + 1; k < coordinates.length && distM < maxStubM; k++) {
      distM += haversineM(
        toLatLng(coordinates[k - 1]),
        toLatLng(coordinates[k]),
      );
      const fromStart = haversineM(
        toLatLng(coordinates[i]),
        toLatLng(coordinates[k]),
      );
      if (fromStart > maxDistFromStart) {
        maxDistFromStart = fromStart;
        tipIndex = k;
      }
    }

    if (maxDistFromStart < minStubM) continue;

    const tipStart = Math.max(i + 1, tipIndex - tipWindow);
    const tipEnd = Math.min(coordinates.length - 2, tipIndex + tipWindow);
    if (tipEnd <= tipStart + 1) continue;

    const inBearing = bearingDeg(
      toLatLng(coordinates[i]),
      toLatLng(coordinates[tipStart]),
    );
    const outBearing = bearingDeg(
      toLatLng(coordinates[tipEnd]),
      toLatLng(coordinates[Math.min(tipEnd + 2, coordinates.length - 1)]),
    );
    if (bearingDelta(inBearing, outBearing) < 125) continue;

    for (let j = tipEnd + 1; j < Math.min(i + 80, coordinates.length); j++) {
      if (haversineM(toLatLng(coordinates[i]), toLatLng(coordinates[j])) > 35) {
        continue;
      }
      const stubM = pathLengthM(coordinates, i, j);
      if (stubM < minStubM) continue;
      ranges.push({ start: i + 1, end: j - 1 });
      break;
    }
  }

  return mergeSpurRanges(ranges);
}

/** Also catch same-segment reversal (BRouter backtracking on one street). */
export function findReverseSegmentSpurRanges(coordinates: Coord[]): SpurRange[] {
  if (coordinates.length < 16) return [];

  const ranges: SpurRange[] = [];
  const matchM = 45;
  const minGap = 6;
  const window = Math.min(320, Math.floor(coordinates.length * 0.6));
  const minSpurM = 28;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = toLatLng(coordinates[i]);
    const b = toLatLng(coordinates[i + 1]);
    if (haversineM(a, b) < 10) continue;

    for (let j = i + minGap; j < Math.min(i + window, coordinates.length - 1); j++) {
      const c = toLatLng(coordinates[j]);
      const d = toLatLng(coordinates[j + 1]);

      const reversed =
        haversineM(a, d) < matchM && haversineM(b, c) < matchM;
      if (!reversed) continue;

      const spurPathM = pathLengthM(coordinates, i, j + 1);
      if (spurPathM < minSpurM) continue;
      if (spurPathM > totalPathLengthM(coordinates) * 0.28) continue;

      ranges.push({ start: i + 1, end: j });
      break;
    }
  }

  return mergeSpurRanges(ranges);
}

function mergeSpurRanges(ranges: SpurRange[]): SpurRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: SpurRange[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end + 1) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function removeSpurRanges(coordinates: Coord[], ranges: SpurRange[]): Coord[] {
  if (ranges.length === 0) return coordinates;

  const remove = new Set<number>();
  for (const range of ranges) {
    for (let i = range.start; i <= range.end; i++) {
      remove.add(i);
    }
  }

  const pruned = coordinates.filter((_, index) => !remove.has(index));
  return dedupeAdjacentPoints(pruned, 3);
}

function dedupeAdjacentPoints(coordinates: Coord[], minDistM: number): Coord[] {
  if (coordinates.length === 0) return [];

  const result: Coord[] = [coordinates[0]];
  for (let i = 1; i < coordinates.length; i++) {
    const prev = toLatLng(result[result.length - 1]);
    const current = toLatLng(coordinates[i]);
    if (haversineM(prev, current) >= minDistM) {
      result.push(coordinates[i]);
    }
  }
  return result.length >= 2 ? result : coordinates;
}

export interface PruneSpursResult {
  coordinates: Coord[];
  removedRanges: SpurRange[];
  removedM: number;
}

const APPROACH_MIN_REMAINING_RATIO = 0.55;

/** Iteratively remove dead-end spurs from an open approach leg. */
export function pruneApproachDeadEndSpurs(coordinates: Coord[]): PruneSpursResult {
  let current = coordinates;
  const allRanges: SpurRange[] = [];
  const beforeM = totalPathLengthM(coordinates);

  for (let pass = 0; pass < 8; pass++) {
    const ranges = mergeSpurRanges([
      ...findDeadEndSpurRanges(current),
      ...findMicroSpurRanges(current),
      ...findHairpinSpurRanges(current),
      ...findReverseSegmentSpurRanges(current),
      ...findOpenPathBranchStubRanges(current),
    ]);

    if (ranges.length === 0) break;

    allRanges.push(
      ...ranges.map((range) => ({
        start: range.start,
        end: range.end,
      })),
    );

    current = removeSpurRanges(current, ranges);
    if (current.length < 2) {
      current = coordinates;
      break;
    }
  }

  const afterM = totalPathLengthM(current);
  if (afterM < beforeM * APPROACH_MIN_REMAINING_RATIO) {
    return {
      coordinates,
      removedRanges: [],
      removedM: 0,
    };
  }

  return {
    coordinates: current,
    removedRanges: mergeSpurRanges(allRanges),
    removedM: Math.max(0, beforeM - afterM),
  };
}

/** Max straight-line gap between consecutive nav points (meters). */
export const MAX_NAV_EDGE_M = 200;

export function maxConsecutiveEdgeM(coordinates: Coord[]): number {
  let max = 0;
  for (let i = 1; i < coordinates.length; i++) {
    max = Math.max(
      max,
      haversineM(toLatLng(coordinates[i - 1]), toLatLng(coordinates[i])),
    );
  }
  return max;
}

/** True when consecutive points jump across unmapped space (Wahoo / GPX unsafe). */
export function hasBrokenRouteGeometry(
  coordinates: Coord[],
  maxLegM = MAX_NAV_EDGE_M,
): boolean {
  if (coordinates.length < 2) return false;
  return maxConsecutiveEdgeM(coordinates) > maxLegM;
}

/** Iteratively remove dead-end spurs from a routed loop. */
export function pruneDeadEndSpurs(coordinates: Coord[]): PruneSpursResult {
  let current = coordinates;
  const allRanges: SpurRange[] = [];
  const beforeM = totalPathLengthM(coordinates);

  for (let pass = 0; pass < 10; pass++) {
    const ranges = mergeSpurRanges([
      ...findDeadEndSpurRanges(current),
      ...findMicroSpurRanges(current),
      ...findHairpinSpurRanges(current),
      ...findReverseSegmentSpurRanges(current),
      ...findOpenPathBranchStubRanges(current),
    ]);

    if (ranges.length === 0) break;

    allRanges.push(
      ...ranges.map((range) => ({
        start: range.start,
        end: range.end,
      })),
    );

    current = removeSpurRanges(current, ranges);
    if (current.length < 4) {
      current = coordinates;
      break;
    }
  }

  const afterM = totalPathLengthM(current);
  if (afterM < beforeM * 0.58) {
    return {
      coordinates,
      removedRanges: [],
      removedM: 0,
    };
  }

  if (hasBrokenRouteGeometry(current) && !hasBrokenRouteGeometry(coordinates)) {
    return {
      coordinates,
      removedRanges: [],
      removedM: 0,
    };
  }

  return {
    coordinates: current,
    removedRanges: mergeSpurRanges(allRanges),
    removedM: Math.max(0, beforeM - afterM),
  };
}

function pointToSegmentDistanceM(
  point: Coord,
  segStart: Coord,
  segEnd: Coord,
): number {
  const p = toLatLng(point);
  const a = toLatLng(segStart);
  const b = toLatLng(segEnd);

  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return haversineM(p, a);

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - segStart[0]) * dx + (point[1] - segStart[1]) * dy) /
        (dx * dx + dy * dy),
    ),
  );

  const proj: LatLng = {
    lng: a.lng + t * dx,
    lat: a.lat + t * dy,
  };
  return haversineM(p, proj);
}

function isPointNearPolyline(
  point: Coord,
  polyline: Coord[],
  maxDistM: number,
): boolean {
  for (let i = 0; i < polyline.length - 1; i++) {
    if (pointToSegmentDistanceM(point, polyline[i], polyline[i + 1]) <= maxDistM) {
      return true;
    }
  }
  return false;
}

function extractNearSubpaths(
  coords: Coord[],
  polyline: Coord[],
  maxDistM: number,
  minRunLengthM: number,
): Coord[][] {
  const runs: Coord[][] = [];
  let current: Coord[] = [];

  const flush = () => {
    if (current.length < 2) {
      current = [];
      return;
    }
    if (pathLengthM(current, 0, current.length - 1) >= minRunLengthM) {
      runs.push(current);
    }
    current = [];
  };

  for (const coord of coords) {
    if (isPointNearPolyline(coord, polyline, maxDistM)) {
      current.push(coord);
    } else {
      flush();
    }
  }
  flush();

  return runs;
}

/** Drop colored segment features that belonged to pruned spur geometry. */
export function pruneMapGeoJson(
  mapGeojson: RouteMapGeoJson | null,
  prunedCoordinates: Coord[],
): RouteMapGeoJson | null {
  if (!mapGeojson?.features.length) return mapGeojson;

  const features = mapGeojson.features
    .flatMap((feature) => {
      const subpaths = extractNearSubpaths(
        feature.geometry.coordinates,
        prunedCoordinates,
        28,
        35,
      );
      if (subpaths.length === 0) return [];

      const longest = subpaths.reduce((best, path) =>
        pathLengthM(path, 0, path.length - 1) >
        pathLengthM(best, 0, best.length - 1)
          ? path
          : best,
      );

      if (longest.length < 2) return [];

      return [
        {
          ...feature,
          geometry: {
            type: "LineString" as const,
            coordinates: longest,
          },
        },
      ];
    })
    .filter((feature) => feature.geometry.coordinates.length >= 2);

  if (features.length === 0) return null;
  return { type: "FeatureCollection", features };
}

/** Strip dead-end spurs before GPX export (map keeps full geometry). */
export function prepareCoordinatesForNavigation(coordinates: Coord[]): Coord[] {
  const pruned = pruneDeadEndSpurs(coordinates);
  const candidate =
    pruned.coordinates.length >= 4 ? pruned.coordinates : coordinates;
  return hasBrokenRouteGeometry(candidate) ? coordinates : candidate;
}

export { totalPathLengthM as routeLengthM };
