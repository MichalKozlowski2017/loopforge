import { describe, expect, it } from "vitest";
import { enrichCoordinatesWithWays } from "./osm-shape-enrich";

describe("enrichCoordinatesWithWays", () => {
  it("splices denser OSM shape nodes into a long chord", () => {
    // Straight BRouter chord across a curved OSM way.
    const from: [number, number] = [21.0, 52.0];
    const to: [number, number] = [21.002, 52.001];
    const route: [number, number][] = [from, to];

    // Arc of intermediate nodes bulging north of the chord (~20–30 m).
    const way: [number, number][] = [
      from,
      [21.0004, 52.00035],
      [21.0008, 52.0005],
      [21.0012, 52.0005],
      [21.0016, 52.00035],
      to,
    ];

    const { coordinates, enrichedEdges } = enrichCoordinatesWithWays(route, [
      way,
    ]);

    expect(enrichedEdges).toBe(1);
    expect(coordinates.length).toBeGreaterThan(2);
    expect(coordinates[0]).toEqual(from);
    expect(coordinates.at(-1)).toEqual(to);
  });

  it("leaves nearly-straight edges alone", () => {
    const from: [number, number] = [21.0, 52.0];
    const to: [number, number] = [21.002, 52.0];
    const route: [number, number][] = [from, to];
    const way: [number, number][] = [
      from,
      [21.0005, 52.0],
      [21.001, 52.0],
      [21.0015, 52.0],
      to,
    ];

    const { coordinates, enrichedEdges } = enrichCoordinatesWithWays(route, [
      way,
    ]);

    expect(enrichedEdges).toBe(0);
    expect(coordinates).toEqual(route);
  });

  it("ignores ways that only match one endpoint", () => {
    const from: [number, number] = [21.0, 52.0];
    const to: [number, number] = [21.002, 52.001];
    const route: [number, number][] = [from, to];
    const way: [number, number][] = [
      from,
      [21.0005, 52.0005],
      [21.001, 52.001],
      [21.0015, 52.002],
    ];

    const { enrichedEdges } = enrichCoordinatesWithWays(route, [way]);
    expect(enrichedEdges).toBe(0);
  });
});
