/**
 * Pick diversified loop candidates for multi-variant generation.
 * Overlap uses a coarse lat/lng grid (~50 m cells near mid-latitudes).
 */

export function corridorCellOverlap(
  a: [number, number][],
  b: [number, number][],
): number {
  const cellsA = routeCellSet(a);
  const cellsB = routeCellSet(b);
  if (cellsA.size === 0 || cellsB.size === 0) return 0;

  let shared = 0;
  for (const key of cellsA) {
    if (cellsB.has(key)) shared++;
  }
  const union = cellsA.size + cellsB.size - shared;
  return union === 0 ? 0 : shared / union;
}

function routeCellSet(coordinates: [number, number][]): Set<string> {
  const cells = new Set<string>();
  const step = Math.max(1, Math.floor(coordinates.length / 180));
  for (let i = 0; i < coordinates.length; i += step) {
    const [lng, lat] = coordinates[i]!;
    // ~0.0005° ≈ 55 m
    cells.add(`${Math.round(lng * 2000)},${Math.round(lat * 2000)}`);
  }
  return cells;
}

export interface RankedLoopCandidate<T> {
  coordinates: [number, number][];
  /** Lower is better (generator quality score). */
  quality: number;
  payload: T;
}

/**
 * Greedy: best quality first, then next that stays under maxOverlap vs picked.
 */
export function pickDiverseLoopCandidates<T>(
  pool: RankedLoopCandidate<T>[],
  count: number,
  maxOverlap = 0.42,
): RankedLoopCandidate<T>[] {
  if (count <= 0 || pool.length === 0) return [];
  const sorted = [...pool].sort((a, b) => a.quality - b.quality);
  const picked: RankedLoopCandidate<T>[] = [];

  for (const candidate of sorted) {
    if (picked.length >= count) break;
    const diverseEnough =
      picked.length === 0 ||
      picked.every(
        (existing) =>
          corridorCellOverlap(existing.coordinates, candidate.coordinates) <=
          maxOverlap,
      );
    if (diverseEnough) picked.push(candidate);
  }

  return picked;
}

export function normalizeLoopVariantCount(value: unknown): 1 | 2 | 3 {
  if (value === 2 || value === 3) return value;
  if (value === "2") return 2;
  if (value === "3") return 3;
  return 1;
}
