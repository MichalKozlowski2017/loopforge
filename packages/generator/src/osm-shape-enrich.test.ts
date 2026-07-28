import { describe, expect, it } from "vitest";
import {
  enrichCoordinatesWithWays,
  recolorCoordinatesFromMapGeojson,
} from "./osm-shape-enrich";
import type { RouteMapGeoJson } from "@loopforge/osm-types";

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

describe("recolorCoordinatesFromMapGeojson", () => {
  it("transfers surface styles onto a denser polished polyline", () => {
    const source: RouteMapGeoJson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            surface: "asphalt",
            label: "Asfalt",
            category: "paved",
            color: "#94a3b8",
            dash: [],
            highway: "residential",
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [21.0, 52.0],
              [21.002, 52.0],
            ],
          },
        },
      ],
    };

    const polished: [number, number][] = [
      [21.0, 52.0],
      [21.0007, 52.0],
      [21.0014, 52.0],
      [21.002, 52.0],
    ];

    const colored = recolorCoordinatesFromMapGeojson(polished, source);
    expect(colored?.features.length).toBeGreaterThanOrEqual(1);
    expect(
      colored?.features.every((f) => f.properties.label === "Asfalt"),
    ).toBe(true);
    expect(
      colored?.features.every((f) => f.properties.color === "#94a3b8"),
    ).toBe(true);
  });

  it("does not invent purple unknown styles when source is missing", () => {
    const polished: [number, number][] = [
      [21.0, 52.0],
      [21.002, 52.0],
    ];
    expect(
      recolorCoordinatesFromMapGeojson(polished, undefined),
    ).toBeUndefined();
  });
});
