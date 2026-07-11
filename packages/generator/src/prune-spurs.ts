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

/**
 * Find out-and-back dead-end spurs: path leaves a point and returns to ~same spot
 * after a detour (cul-de-sac, service road, path stub).
 */
export function findDeadEndSpurRanges(coordinates: Coord[]): SpurRange[] {
  if (coordinates.length < 20) return [];

  const ranges: SpurRange[] = [];
  const matchM = 32;
  const minSpurM = 45;
  const minGap = 12;
  const maxSpan = Math.floor(coordinates.length * 0.45);

  for (let i = 0; i < coordinates.length - minGap; i++) {
    const origin = toLatLng(coordinates[i]);

    for (let j = i + minGap; j < coordinates.length; j++) {
      if (j - i > maxSpan) break;

      const returnPt = toLatLng(coordinates[j]);
      if (haversineM(origin, returnPt) > matchM) continue;

      const spurPathM = pathLengthM(coordinates, i, j);
      if (spurPathM < minSpurM) continue;

      const straightM = Math.max(haversineM(origin, returnPt), 1);
      const detourRatio = spurPathM / straightM;
      if (detourRatio < 1.6) continue;

      const mid = Math.floor((i + j) / 2);
      const midPt = toLatLng(coordinates[mid]);
      if (haversineM(origin, midPt) < Math.min(spurPathM * 0.35, 80)) continue;

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
  const matchM = 38;
  const minGap = 8;
  const window = Math.min(280, Math.floor(coordinates.length * 0.55));
  const minSpurM = 40;

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

/** Iteratively remove dead-end spurs from a routed loop. */
export function pruneDeadEndSpurs(coordinates: Coord[]): PruneSpursResult {
  let current = coordinates;
  const allRanges: SpurRange[] = [];
  const beforeM = totalPathLengthM(coordinates);

  for (let pass = 0; pass < 4; pass++) {
    const culDeSac = findDeadEndSpurRanges(current);
    const reversed = findReverseSegmentSpurRanges(current);
    const ranges = mergeSpurRanges([...culDeSac, ...reversed]);

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

/** Drop colored segment features that belonged to pruned spur geometry. */
export function pruneMapGeoJson(
  mapGeojson: RouteMapGeoJson | null,
  prunedCoordinates: Coord[],
): RouteMapGeoJson | null {
  if (!mapGeojson?.features.length) return mapGeojson;

  const features = mapGeojson.features
    .map((feature) => {
      const kept = feature.geometry.coordinates.filter((coord) =>
        isPointNearPolyline(coord, prunedCoordinates, 42),
      );
      if (kept.length < 2) return null;
      return {
        ...feature,
        geometry: {
          type: "LineString" as const,
          coordinates: kept,
        },
      };
    })
    .filter((feature): feature is NonNullable<typeof feature> => feature !== null);

  if (features.length === 0) return null;
  return { type: "FeatureCollection", features };
}

export { totalPathLengthM as routeLengthM };
