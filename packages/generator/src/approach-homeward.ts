import type { LatLng } from "@loopforge/osm-types";

const EARTH_RADIUS_M = 6_371_000;
const MIN_LOOP_PROGRESS = 0.48;
const APPROACH_CORRIDOR_M = 400;

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

function haversineM(a: LatLng, b: LatLng): number {
  return haversineCoordsM([a.lng, a.lat], [b.lng, b.lat]);
}

function coordNear(a: [number, number], b: [number, number], maxM: number): boolean {
  return haversineCoordsM(a, b) <= maxM;
}

function pointToSegmentDistanceM(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const latRad = toRadians(p[1]);
  const scaleX = EARTH_RADIUS_M * Math.cos(latRad) * (Math.PI / 180);
  const scaleY = EARTH_RADIUS_M * (Math.PI / 180);

  const ax = (a[0] - p[0]) * scaleX;
  const ay = (a[1] - p[1]) * scaleY;
  const bx = (b[0] - p[0]) * scaleX;
  const by = (b[1] - p[1]) * scaleY;

  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(ax, ay);

  let t = -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function nearPolyline(
  point: [number, number],
  line: [number, number][],
  matchM: number,
): boolean {
  for (let i = 1; i < line.length; i++) {
    if (pointToSegmentDistanceM(point, line[i - 1]!, line[i]!) <= matchM) {
      return true;
    }
  }
  return false;
}

function rotateLoopToEntry(
  loopCoordinates: [number, number][],
  entry: [number, number],
): [number, number][] {
  if (loopCoordinates.length < 2) return loopCoordinates;

  let startIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < loopCoordinates.length; i++) {
    const d = haversineCoordsM(loopCoordinates[i]!, entry);
    if (d < bestD) {
      bestD = d;
      startIdx = i;
    }
  }

  const rotated = [
    ...loopCoordinates.slice(startIdx),
    ...loopCoordinates.slice(0, startIdx),
  ];
  const last = rotated[rotated.length - 1]!;
  const first = rotated[0]!;
  if (coordNear(last, first, 80)) {
    return rotated.slice(0, -1);
  }
  return rotated;
}

/** Index on the loop (from entry) where continuing toward home is most natural. */
export function findHomewardLoopExitIndex(
  loopFromEntry: [number, number][],
  home: LatLng,
  approachCoordinates: [number, number][],
): number {
  if (loopFromEntry.length < 4) return loopFromEntry.length - 1;

  const cum: number[] = [0];
  for (let i = 1; i < loopFromEntry.length; i++) {
    cum.push(cum[i - 1]! + haversineCoordsM(loopFromEntry[i - 1]!, loopFromEntry[i]!));
  }
  const totalM = cum[cum.length - 1] ?? 0;
  const minM = totalM * MIN_LOOP_PROGRESS;

  const distAtEntry = haversineM(
    { lng: loopFromEntry[0]![0], lat: loopFromEntry[0]![1] },
    home,
  );

  let bestIdx = loopFromEntry.length - 1;
  let bestScore = -Infinity;

  for (let i = 1; i < loopFromEntry.length; i++) {
    if ((cum[i] ?? 0) < minM) continue;

    const p = loopFromEntry[i]!;
    const distHome = haversineM({ lng: p[0], lat: p[1] }, home);
    const onCorridor = nearPolyline(p, approachCoordinates, APPROACH_CORRIDOR_M);
    const closerThanEntry = distHome < distAtEntry + 200;

    let score = -distHome;
    if (onCorridor) score += 900;
    if (closerThanEntry) score += 450;
    score += (cum[i] ?? 0) / totalM / 10;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/** Loop from entry to homeward exit — no return spur to the orange marker. */
export function sliceLoopForHomewardReturn(
  loopCoordinates: [number, number][],
  entry: [number, number],
  home: LatLng,
  approachCoordinates: [number, number][],
): [number, number][] {
  if (loopCoordinates.length < 4) return loopCoordinates;

  const fromEntry = rotateLoopToEntry(loopCoordinates, entry);
  if (fromEntry.length < 4) return fromEntry;

  const exitIdx = findHomewardLoopExitIndex(fromEntry, home, approachCoordinates);
  const sliced = fromEntry.slice(0, exitIdx + 1);
  return sliced.length >= 3 ? sliced : fromEntry;
}

export function reverseApproachCoordinates(
  approach: [number, number][],
): [number, number][] {
  return [...approach].reverse();
}

/** Return leg from loop exit back to home along the outbound approach corridor. */
export function buildReturnApproachToHome(
  approach: [number, number][],
  loopExit: [number, number],
): [number, number][] {
  if (approach.length < 2) return reverseApproachCoordinates(approach);

  let joinIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < approach.length; i++) {
    const d = haversineCoordsM(approach[i]!, loopExit);
    if (d < bestD) {
      bestD = d;
      joinIdx = i;
    }
  }

  if (bestD > 600) {
    return reverseApproachCoordinates(approach);
  }

  const returnLeg: [number, number][] = [loopExit];
  for (let i = joinIdx; i >= 0; i--) {
    const next = approach[i]!;
    const prev = returnLeg[returnLeg.length - 1]!;
    if (prev[0] !== next[0] || prev[1] !== next[1]) {
      returnLeg.push(next);
    }
  }
  return returnLeg.length >= 2 ? returnLeg : reverseApproachCoordinates(approach);
}
