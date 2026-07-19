import type { RouteMapGeoJson } from "@loopforge/osm-types";
import {
  geometrySafetyLimits,
  inferGeometrySafetyLimits,
  type GeometrySafetyLimits,
} from "./urban-context";

type Coord = [number, number];
type LatLng = { lat: number; lng: number };

export type GeometryContext = {
  /**
   * Optional hard override (tests / legacy). Prefer `start` + infer-from-coords.
   * When set, skips polyline inference.
   */
  urban?: boolean;
  /** Generation start — biases metro when the pin is in a metro bbox. */
  start?: LatLng;
};

function resolveGeometryLimits(
  coordinates: Coord[],
  context: GeometryContext = {},
): GeometrySafetyLimits {
  if (context.urban === true) return geometrySafetyLimits(true);
  if (context.urban === false && context.start == null) {
    return geometrySafetyLimits(false);
  }
  return inferGeometrySafetyLimits(coordinates, context.start);
}

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
  matchM: 140,
  minSpurM: 16,
  minGap: 5,
  maxSpanRatio: 0.65,
  minDetourRatio: 1.08,
  midBulgeRatio: 0.14,
  maxMidBulgeM: 180,
};

const MICRO_SPUR_CONFIG: SpurDetectConfig = {
  matchM: 55,
  minSpurM: 8,
  minGap: 4,
  maxSpanRatio: 0.4,
  minDetourRatio: 1.08,
  midBulgeRatio: 0.12,
  maxMidBulgeM: 90,
};

/** Longer cul-de-sac / park stubs that rejoin near the same junction. */
const STUB_SPUR_CONFIG: SpurDetectConfig = {
  matchM: 180,
  minSpurM: 28,
  minGap: 6,
  maxSpanRatio: 0.5,
  minDetourRatio: 1.12,
  midBulgeRatio: 0.15,
  maxMidBulgeM: 280,
};

function findDeadEndSpurRangesWithConfig(
  coordinates: Coord[],
  config: SpurDetectConfig,
): SpurRange[] {
  if (coordinates.length < 12) return [];

  const ranges: SpurRange[] = [];
  const maxSpan = Math.floor(coordinates.length * config.maxSpanRatio);
  const totalM = totalPathLengthM(coordinates);
  const maxSpurM = Math.max(3500, totalM * 0.32);
  /** Dense GeoJSON: also cap by path meters so long stubs aren't cut by vertex span. */
  const maxSpanM = Math.max(maxSpurM, config.matchM * 40);

  for (let i = 0; i < coordinates.length - config.minGap; i++) {
    const origin = toLatLng(coordinates[i]);
    let best: SpurRange | null = null;
    let bestPathM = 0;
    let spanM = 0;

    for (let j = i + 1; j < coordinates.length; j++) {
      spanM += haversineM(
        toLatLng(coordinates[j - 1]!),
        toLatLng(coordinates[j]!),
      );
      if (j - i < config.minGap) continue;
      if (j - i > maxSpan && spanM > maxSpanM) break;
      if (spanM > maxSpurM * 1.15) break;

      const returnPt = toLatLng(coordinates[j]);
      const rejoinDist = haversineM(origin, returnPt);
      // Keep match tight — adaptive budgets were picking "rejoins" past the
      // true junction on the continuing corridor (stitch then exceeded limit).
      if (rejoinDist > config.matchM) continue;

      const spurPathM = spanM;
      if (spurPathM < config.minSpurM) continue;
      if (spurPathM > maxSpurM) continue;

      // Loop closure near start/end is the main route, not a dead-end spur.
      if (i < 3 && j > coordinates.length * 0.45) continue;
      if (j >= coordinates.length - 4 && i < coordinates.length * 0.12) {
        continue;
      }

      const straightM = Math.max(rejoinDist, 1);
      if (spurPathM / straightM < config.minDetourRatio) continue;

      const mid = Math.floor((i + j) / 2);
      const midPt = toLatLng(coordinates[mid]);
      const detour = spurPathM / straightM;
      const bulgeNeed =
        detour >= 2.5
          ? Math.min(spurPathM * 0.08, config.maxMidBulgeM)
          : Math.min(spurPathM * config.midBulgeRatio, config.maxMidBulgeM);
      if (haversineM(origin, midPt) < bulgeNeed) {
        continue;
      }

      // Prefer tight junction rejoin, then longer stub (avoid overshooting past tip).
      const score = spurPathM - rejoinDist * 40;
      if (score > bestPathM) {
        bestPathM = score;
        best = { start: i + 1, end: j - 1 };
      }
    }

    if (best && best.end >= best.start) {
      ranges.push(best);
    }
  }

  return ranges;
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

/** Medium park / service-road stubs that return to the same junction. */
export function findStubSpurRanges(coordinates: Coord[]): SpurRange[] {
  return findDeadEndSpurRangesWithConfig(coordinates, STUB_SPUR_CONFIG);
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
  const maxStubM = 1500;
  const minStubM = 12;
  const rejoinM = 160;
  const minTurnDeg = 16;
  const endReserve = 8;

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

      // Require the stub to actually leave the junction (not a tiny wobble).
      let maxAway = 0;
      for (let t = j + 1; t < k; t++) {
        maxAway = Math.max(
          maxAway,
          haversineM(junction, toLatLng(coordinates[t]!)),
        );
      }
      if (maxAway < Math.min(28, stubM * 0.2)) continue;

      ranges.push({ start: j + 1, end: k - 1 });
      break;
    }
  }

  return ranges;
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

/** Detection-only cap; actual remove uses context budget from geometrySafetyLimits. */
const MAX_DETECT_STITCH_M = 120;

/** Sharp hairpin at a dead-end tip (route turns ~180° within a short stub). */
export function findHairpinSpurRanges(coordinates: Coord[]): SpurRange[] {
  if (coordinates.length < 10) return [];

  const ranges: SpurRange[] = [];
  const maxStubM = 500;
  const minStubM = 14;
  const tipWindow = 8;

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
    if (bearingDelta(inBearing, outBearing) < 120) continue;

    let returnSpanM = 0;
    for (let j = tipEnd + 1; j < coordinates.length; j++) {
      returnSpanM += haversineM(
        toLatLng(coordinates[j - 1]!),
        toLatLng(coordinates[j]!),
      );
      if (returnSpanM > maxStubM) break;
      if (haversineM(toLatLng(coordinates[i]), toLatLng(coordinates[j])) > 160) {
        continue;
      }
      const stubM = pathLengthM(coordinates, i, j);
      if (stubM < minStubM) continue;
      ranges.push({ start: i + 1, end: j - 1 });
      break;
    }
  }

  return ranges;
}

/** Also catch same-segment reversal (BRouter backtracking on one street). */
export function findReverseSegmentSpurRanges(coordinates: Coord[]): SpurRange[] {
  if (coordinates.length < 16) return [];

  const ranges: SpurRange[] = [];
  const matchM = 90;
  const minGap = 5;
  /** Dense GeoJSON: search by meters, not a fixed ~400 vertex window. */
  const maxWindowM = 4000;
  const minSpurM = 20;
  const totalM = totalPathLengthM(coordinates);

  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = toLatLng(coordinates[i]);
    const b = toLatLng(coordinates[i + 1]);
    const ab = haversineM(a, b);
    if (ab < 8) continue;
    const fwd = bearingDeg(a, b);

    let spanM = 0;
    for (let j = i + 1; j < coordinates.length - 1; j++) {
      spanM += haversineM(
        toLatLng(coordinates[j - 1]!),
        toLatLng(coordinates[j]!),
      );
      if (j - i < minGap) continue;
      if (spanM > maxWindowM) break;

      const c = toLatLng(coordinates[j]);
      const d = toLatLng(coordinates[j + 1]);
      const cd = haversineM(c, d);
      if (cd < 8) continue;

      // Must actually reverse direction — dense same-way points sit within matchM.
      const back = bearingDeg(c, d);
      if (bearingDelta(fwd, back) < 150) continue;

      const reversed =
        haversineM(a, d) < matchM && haversineM(b, c) < matchM;
      if (!reversed) continue;

      const spurPathM = pathLengthM(coordinates, i, j + 1);
      if (spurPathM < minSpurM) continue;
      if (spurPathM > totalM * 0.35) continue;

      const after = Math.min(coordinates.length - 1, j + 1);
      const stitchM = haversineM(
        toLatLng(coordinates[i]!),
        toLatLng(coordinates[after]!),
      );
      // Reject corridor-wide false positives; final budget applied in removeSpurRanges.
      if (stitchM > MAX_DETECT_STITCH_M) continue;

      ranges.push({ start: i + 1, end: j });
      break;
    }
  }

  return ranges;
}

function wouldCreateAirChord(
  coordinates: Coord[],
  ranges: SpurRange[],
  maxStitchM: number,
): boolean {
  if (ranges.length === 0) return false;

  const remove = new Set<number>();
  for (const range of ranges) {
    for (let i = range.start; i <= range.end; i++) {
      remove.add(i);
    }
  }

  let prevKept = -1;
  for (let i = 0; i < coordinates.length; i++) {
    if (remove.has(i)) continue;
    if (prevKept >= 0 && i > prevKept + 1) {
      const stitchM = haversineM(
        toLatLng(coordinates[prevKept]!),
        toLatLng(coordinates[i]!),
      );
      if (stitchM > maxStitchM) return true;
    }
    prevKept = i;
  }
  return false;
}

function rangesOverlap(a: SpurRange, b: SpurRange): boolean {
  return !(a.end < b.start - 1 || a.start > b.end + 1);
}

/** Local median edge length around an index — town fabric vs open country. */
function localMedianEdgeM(
  coordinates: Coord[],
  index: number,
  window = 14,
): number {
  const edges: number[] = [];
  const from = Math.max(1, index - window);
  const to = Math.min(coordinates.length - 1, index + window);
  for (let i = from; i <= to; i++) {
    edges.push(
      haversineM(toLatLng(coordinates[i - 1]!), toLatLng(coordinates[i]!)),
    );
  }
  if (edges.length === 0) return 0;
  const sorted = [...edges].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Adaptive stitch budget at a junction: dense town streets allow wider rejoins
 * for dead-end cuts; open legs stay tight against field chords.
 */
function stitchBudgetAtJunction(
  coordinates: Coord[],
  beforeIdx: number,
  baseMaxStitchM: number,
): number {
  const localMed = localMedianEdgeM(coordinates, beforeIdx);
  if (localMed > 0 && localMed < 28) {
    return Math.min(110, Math.max(baseMaxStitchM, 100));
  }
  if (localMed > 45) {
    return Math.min(baseMaxStitchM, 70);
  }
  return baseMaxStitchM;
}

function removeSpurRanges(
  coordinates: Coord[],
  ranges: SpurRange[],
  baseMaxStitchM: number,
): Coord[] {
  if (ranges.length === 0) return coordinates;

  // Largest safe stubs first — never abort the whole set for one bad combo.
  const candidates = ranges
    .map((range) => {
      const before = Math.max(0, range.start - 1);
      const after = Math.min(coordinates.length - 1, range.end + 1);
      if (after <= before) return null;
      const stitchM = haversineM(
        toLatLng(coordinates[before]!),
        toLatLng(coordinates[after]!),
      );
      const maxStitchM = stitchBudgetAtJunction(
        coordinates,
        before,
        baseMaxStitchM,
      );
      if (stitchM > maxStitchM) return null;
      return {
        range,
        pathM: pathLengthM(coordinates, range.start, range.end + 1),
        stitchM,
        maxStitchM,
      };
    })
    .filter(
      (
        item,
      ): item is {
        range: SpurRange;
        pathM: number;
        stitchM: number;
        maxStitchM: number;
      } => item != null,
    )
    // Prefer long stubs with tight junction stitches (true out-and-backs).
    .sort(
      (a, b) =>
        b.pathM - b.stitchM * 100 - (a.pathM - a.stitchM * 100),
    );

  const accepted: SpurRange[] = [];
  for (const candidate of candidates) {
    if (accepted.some((r) => rangesOverlap(r, candidate.range))) continue;
    const trial = [...accepted, candidate.range];
    // Use the candidate's local budget so town cuts aren't blocked by rural cap.
    if (wouldCreateAirChord(coordinates, trial, candidate.maxStitchM)) {
      continue;
    }
    accepted.push(candidate.range);
  }

  if (accepted.length === 0) return coordinates;

  const remove = new Set<number>();
  for (const range of accepted) {
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
export function pruneApproachDeadEndSpurs(
  coordinates: Coord[],
  context: GeometryContext = {},
): PruneSpursResult {
  const { maxPruneStitchM } = resolveGeometryLimits(coordinates, context);
  let current = coordinates;
  const allRanges: SpurRange[] = [];
  const beforeM = totalPathLengthM(coordinates);

  for (let pass = 0; pass < 8; pass++) {
    // Do not merge before remove — merging nested stubs creates unsplittable mega-ranges.
    const ranges = [
      ...findDeadEndSpurRanges(current),
      ...findMicroSpurRanges(current),
      ...findStubSpurRanges(current),
      ...findHairpinSpurRanges(current),
      ...findReverseSegmentSpurRanges(current),
      ...findOpenPathBranchStubRanges(current),
    ];

    if (ranges.length === 0) break;

    const beforePass = current.length;
    current = removeSpurRanges(current, ranges, maxPruneStitchM);
    if (current.length === beforePass) break;

    allRanges.push(...ranges);
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

function edgeLengthsM(coordinates: Coord[]): number[] {
  const edges: number[] = [];
  for (let i = 1; i < coordinates.length; i++) {
    edges.push(
      haversineM(toLatLng(coordinates[i - 1]), toLatLng(coordinates[i])),
    );
  }
  return edges;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

export function maxConsecutiveEdgeM(coordinates: Coord[]): number {
  const edges = edgeLengthsM(coordinates);
  return edges.length > 0 ? Math.max(...edges) : 0;
}

/**
 * Long edge with short local neighbours — catches rails/roundabout cuts inside
 * an otherwise rural loop (global p95 stays high).
 */
function hasLocalAirChordEdge(
  coordinates: Coord[],
  limits: GeometrySafetyLimits,
): boolean {
  if (!limits.useLocalAirChordCheck || coordinates.length < 8) return false;

  const edges = edgeLengthsM(coordinates);
  const window = 12;
  for (let i = 0; i < edges.length; i++) {
    const edgeM = edges[i]!;
    if (edgeM < limits.localAirChordMinM) continue;

    const nearby: number[] = [];
    for (
      let j = Math.max(0, i - window);
      j < Math.min(edges.length, i + window + 1);
      j++
    ) {
      if (j !== i) nearby.push(edges[j]!);
    }
    if (nearby.length < 4) continue;
    const sorted = [...nearby].sort((a, b) => a - b);
    const localMed = sorted[Math.floor(sorted.length / 2)]!;
    if (
      localMed > 0 &&
      localMed < limits.localAirChordMedianMaxM &&
      edgeM > localMed * limits.localAirChordRatio
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Hard teleport only — used when accepting/rejecting BRouter candidates.
 * Must not false-positive on normal dense GeoJSON straights or rural legs.
 */
export function hasHardTeleportEdge(coordinates: Coord[]): boolean {
  if (coordinates.length < 3) return false;
  return maxConsecutiveEdgeM(coordinates) > 1200;
}

/**
 * Stricter geometry checks after prune / for map fidelity.
 * Not used to discard raw BRouter variants (that blocked all generation).
 */
export function hasSuspiciousTeleportEdge(
  coordinates: Coord[],
  context: GeometryContext = {},
): boolean {
  if (coordinates.length < 3) return false;
  if (hasHardTeleportEdge(coordinates)) return true;

  const limits = resolveGeometryLimits(coordinates, context);
  if (hasLocalAirChordEdge(coordinates, limits)) return true;

  if (!limits.useDenseTeleportCheck) return false;

  const edges = edgeLengthsM(coordinates);
  const max = Math.max(...edges);
  const sorted = [...edges].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);

  if (
    p95 > 0 &&
    p95 < limits.denseP95MaxM &&
    max > limits.denseOutlierMinM &&
    max > p95 * 6
  ) {
    return true;
  }

  return false;
}

/**
 * Detect geometry unsafe for GPS after spur prune.
 * Flag *new* stitches longer than the inferred junction budget.
 */
export function hasBrokenRouteGeometry(
  after: Coord[],
  before?: Coord[],
  context: GeometryContext = {},
): boolean {
  if (hasSuspiciousTeleportEdge(after, context)) return true;

  const { maxPruneStitchM } = resolveGeometryLimits(after, context);
  if (before && before.length >= 2) {
    const beforeMax = maxConsecutiveEdgeM(before);
    const afterMax = maxConsecutiveEdgeM(after);
    // Allow adaptive town stitches slightly above the base budget.
    const ceiling = Math.max(maxPruneStitchM, 110);
    if (afterMax > ceiling && afterMax > beforeMax + 10) {
      return true;
    }
  }
  return false;
}

/** @deprecated Use hasBrokenRouteGeometry — kept for tuning/tests. */
export const MAX_NAV_EDGE_M = 1200;

/** Iteratively remove dead-end spurs from a routed loop. */
export function pruneDeadEndSpurs(
  coordinates: Coord[],
  context: GeometryContext = {},
): PruneSpursResult {
  const { maxPruneStitchM } = resolveGeometryLimits(coordinates, context);
  let current = coordinates;
  const allRanges: SpurRange[] = [];
  const beforeM = totalPathLengthM(coordinates);

  for (let pass = 0; pass < 14; pass++) {
    // Do not merge before remove — merging nested stubs creates unsplittable mega-ranges.
    const ranges = [
      ...findDeadEndSpurRanges(current),
      ...findMicroSpurRanges(current),
      ...findStubSpurRanges(current),
      ...findHairpinSpurRanges(current),
      ...findReverseSegmentSpurRanges(current),
      ...findOpenPathBranchStubRanges(current),
    ];

    if (ranges.length === 0) break;

    const beforePass = current.length;
    current = removeSpurRanges(current, ranges, maxPruneStitchM);
    if (current.length === beforePass) break;

    allRanges.push(...ranges);
    if (current.length < 4) {
      current = coordinates;
      break;
    }
  }

  const afterM = totalPathLengthM(current);
  // Allow removing large dead-end appendages (common when BRouter pads distance).
  if (afterM < beforeM * 0.25) {
    return {
      coordinates,
      removedRanges: [],
      removedM: 0,
    };
  }

  if (hasBrokenRouteGeometry(current, coordinates, context)) {
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

/** Strip dead-end spurs so map + GPX share the same cleaned polyline. */
export function prepareCoordinatesForNavigation(
  coordinates: Coord[],
  context: GeometryContext = {},
): Coord[] {
  const pruned = pruneDeadEndSpurs(coordinates, context);
  const candidate =
    pruned.coordinates.length >= 4 ? pruned.coordinates : coordinates;
  return hasBrokenRouteGeometry(candidate, coordinates, context)
    ? coordinates
    : candidate;
}

export { totalPathLengthM as routeLengthM };
