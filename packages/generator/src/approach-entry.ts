import type { LatLng } from "@loopforge/osm-types";
import type { RoutedLeg } from "./approach";

const EARTH_RADIUS_M = 6_371_000;
const MAX_ENTRY_WALKBACK_M = 1_100;
const MIN_APPROACH_FRACTION = 0.5;

export interface RefinedApproachEntry {
  loopEntry: LatLng;
  approachCoordinates: [number, number][];
  approachDistanceKm: number;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineCoordsM(a: [number, number], b: [number, number]): number {
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
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

function coordToLatLng(coord: [number, number]): LatLng {
  return { lng: coord[0], lat: coord[1] };
}

function buildCumulativeDistM(coords: [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1]! + haversineCoordsM(coords[i - 1]!, coords[i]!));
  }
  return cum;
}

function vertexTurnDeg(coords: [number, number][], index: number): number {
  if (index <= 0 || index >= coords.length - 1) return 0;
  const b1 = segmentBearing(coords[index - 1]!, coords[index]!);
  const b2 = segmentBearing(coords[index]!, coords[index + 1]!);
  return angularDiffDeg(b1, b2);
}

function pathDistanceKm(coords: [number, number][]): number {
  let meters = 0;
  for (let i = 1; i < coords.length; i++) {
    meters += haversineCoordsM(coords[i - 1]!, coords[i]!);
  }
  return meters / 1000;
}

function minEntryIndex(cumDist: number[]): number {
  const totalM = cumDist[cumDist.length - 1] ?? 0;
  const minM = totalM * MIN_APPROACH_FRACTION;
  for (let i = 0; i < cumDist.length; i++) {
    if ((cumDist[i] ?? 0) >= minM) return i;
  }
  return 0;
}

function spurJunctionBeforeEnd(
  coords: [number, number][],
  cumDist: number[],
  mainBearing: number,
): number | null {
  const endIdx = coords.length - 1;
  if (endIdx < 2) return null;

  const lastLegM = (cumDist[endIdx] ?? 0) - (cumDist[endIdx - 1] ?? 0);
  const turn = vertexTurnDeg(coords, endIdx - 1);
  const lastBearing = segmentBearing(coords[endIdx - 1]!, coords[endIdx]!);
  const offCorridor = angularDiffDeg(lastBearing, mainBearing);

  if (
    (turn >= 28 && lastLegM < 750) ||
    (offCorridor >= 46 && lastLegM < 950) ||
    (turn >= 38 && lastLegM < 1_200)
  ) {
    return endIdx - 1;
  }
  return null;
}

function bestJunctionIndex(
  coords: [number, number][],
  cumDist: number[],
  minIdx: number,
  maxWalkbackM: number,
): number {
  const endIdx = coords.length - 1;
  const endDist = cumDist[endIdx] ?? 0;
  let bestIdx = endIdx;
  let bestScore = -Infinity;

  for (let i = endIdx; i >= minIdx; i--) {
    const distFromEnd = endDist - (cumDist[i] ?? 0);
    if (distFromEnd > maxWalkbackM) break;

    const turn =
      i < endIdx ? vertexTurnDeg(coords, i) : vertexTurnDeg(coords, endIdx - 1);
    const continueBearing =
      i < endIdx
        ? segmentBearing(coords[i]!, coords[i + 1]!)
        : segmentBearing(coords[endIdx - 1]!, coords[endIdx]!);
    const mainBearing = segmentBearing(coords[0]!, coords[endIdx]!);
    const aligned = 90 - angularDiffDeg(continueBearing, mainBearing);

    let score = 0;
    if (turn >= 24 && turn <= 115) score += 6 + Math.min(turn, 75) / 12;
    if (i === endIdx && turn >= 30) score -= 8;
    score += aligned / 18;
    score -= distFromEnd / 260;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Pick a loop entry on the approach corridor — prefer a junction over a dead-end
 * spur, and trim the approach leg to that point.
 */
export function refineApproachForLoopEntry(
  approach: RoutedLeg,
  context: { home: LatLng; entryTarget: LatLng },
): RefinedApproachEntry {
  const coords = approach.coordinates;
  if (coords.length < 2) {
    const loopEntry = coords[0]
      ? coordToLatLng(coords[0])
      : context.entryTarget;
    return {
      loopEntry,
      approachCoordinates: coords,
      approachDistanceKm: approach.distanceKm,
    };
  }

  const cumDist = buildCumulativeDistM(coords);
  const minIdx = minEntryIndex(cumDist);
  const mainBearing = segmentBearing(coords[0]!, coords[coords.length - 1]!);

  let entryIdx = coords.length - 1;
  const spurIdx = spurJunctionBeforeEnd(coords, cumDist, mainBearing);
  if (spurIdx != null && spurIdx >= minIdx) {
    entryIdx = spurIdx;
  } else {
    const junctionIdx = bestJunctionIndex(
      coords,
      cumDist,
      minIdx,
      MAX_ENTRY_WALKBACK_M,
    );
    if (junctionIdx < entryIdx) entryIdx = junctionIdx;
  }

  entryIdx = Math.max(minIdx, Math.min(entryIdx, coords.length - 1));
  const trimmed = coords.slice(0, entryIdx + 1) as [number, number][];

  return {
    loopEntry: coordToLatLng(trimmed[trimmed.length - 1]!),
    approachCoordinates: trimmed,
    approachDistanceKm: pathDistanceKm(trimmed),
  };
}
