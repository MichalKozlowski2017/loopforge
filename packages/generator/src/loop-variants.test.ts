import { describe, expect, it } from "vitest";
import {
  corridorCellOverlap,
  normalizeLoopVariantCount,
  pickDiverseLoopCandidates,
} from "./loop-variants";

function box(
  lng0: number,
  lat0: number,
  n = 40,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    out.push([lng0 + i * 0.001, lat0]);
  }
  return out;
}

describe("loop-variants", () => {
  it("normalizes variant count", () => {
    expect(normalizeLoopVariantCount(undefined)).toBe(1);
    expect(normalizeLoopVariantCount(3)).toBe(3);
    expect(normalizeLoopVariantCount(9)).toBe(1);
  });

  it("reports high overlap for near-identical corridors", () => {
    const a = box(21, 52);
    const b = box(21.0001, 52);
    expect(corridorCellOverlap(a, b)).toBeGreaterThan(0.7);
  });

  it("reports low overlap for distant corridors", () => {
    const a = box(21, 52);
    const b = box(21.2, 52.2);
    expect(corridorCellOverlap(a, b)).toBeLessThan(0.15);
  });

  it("picks diverse candidates by quality then separation", () => {
    const pool = [
      { coordinates: box(21, 52), quality: 2, payload: "a" },
      { coordinates: box(21.0002, 52), quality: 2.1, payload: "a-clone" },
      { coordinates: box(21.25, 52.2), quality: 3, payload: "b" },
      { coordinates: box(20.7, 51.9), quality: 4, payload: "c" },
    ];
    const picked = pickDiverseLoopCandidates(pool, 3);
    expect(picked.map((p) => p.payload)).toEqual(["a", "b", "c"]);
  });
});
