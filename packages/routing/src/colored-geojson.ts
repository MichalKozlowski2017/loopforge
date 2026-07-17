import type { OsmTags, RouteMapGeoJson, RouteSegmentFeature } from "@loopforge/osm-types";
import { getSurfaceStyle } from "@loopforge/osm-types";

function hstoreToTags(raw: Record<string, string | null | undefined>): OsmTags {
  const tags: OsmTags = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value != null && value !== "") {
      tags[key] = value;
    }
  }
  return tags;
}

function styleKey(feature: RouteSegmentFeature): string {
  return `${feature.properties.label}|${feature.properties.color}|${feature.properties.category}`;
}

function coordsMatch(
  a: [number, number],
  b: [number, number],
  eps = 1e-6,
): boolean {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

function mergeAdjacentFeatures(
  features: RouteSegmentFeature[],
): RouteSegmentFeature[] {
  if (features.length === 0) return [];

  const merged: RouteSegmentFeature[] = [
    {
      ...features[0],
      geometry: {
        type: "LineString",
        coordinates: [...features[0].geometry.coordinates],
      },
    },
  ];

  for (let i = 1; i < features.length; i++) {
    const current = features[i];
    const previous = merged[merged.length - 1];

    const last = previous.geometry.coordinates.at(-1);
    const first = current.geometry.coordinates[0];
    const contiguous =
      last && first && coordsMatch(last as [number, number], first as [number, number]);

    if (styleKey(previous) === styleKey(current) && contiguous) {
      previous.geometry.coordinates.push(
        ...current.geometry.coordinates.slice(1),
      );
    } else {
      merged.push({
        ...current,
        geometry: {
          type: "LineString",
          coordinates: [...current.geometry.coordinates],
        },
      });
    }
  }

  return merged;
}

export function buildColoredGeoJsonFromSegments(
  segments: { coordinates: [number, number][]; tags: OsmTags }[],
): RouteMapGeoJson {
  const features: RouteSegmentFeature[] = segments
    .filter((segment) => segment.coordinates.length >= 2)
    .map((segment) => {
      const style = getSurfaceStyle(segment.tags);
      return {
        type: "Feature" as const,
        properties: {
          surface: segment.tags.surface ?? style.label,
          label: style.label,
          category: style.category,
          color: style.color,
          dash: style.dash,
          highway: segment.tags.highway,
        },
        geometry: {
          type: "LineString" as const,
          coordinates: segment.coordinates,
        },
      };
    });

  return {
    type: "FeatureCollection",
    features: mergeAdjacentFeatures(features),
  };
}

export function hstoreRowToTags(row: Record<string, string | null>): OsmTags {
  return hstoreToTags(row);
}

export function surfaceBreakdownFromSegments(
  segments: { tags: OsmTags; distanceM: number }[],
): import("@loopforge/osm-types").SurfaceBreakdownItem[] {
  const totals = new Map<string, { distanceM: number; color: string }>();
  let sum = 0;

  for (const segment of segments) {
    const style = getSurfaceStyle(segment.tags);
    const existing = totals.get(style.label) ?? {
      distanceM: 0,
      color: style.color,
    };
    totals.set(style.label, {
      distanceM: existing.distanceM + segment.distanceM,
      color: style.color,
    });
    sum += segment.distanceM;
  }

  if (sum === 0) return [];

  return [...totals.entries()]
    .map(([label, { distanceM, color }]) => ({
      label,
      share: distanceM / sum,
      color,
    }))
    .sort((a, b) => b.share - a.share);
}
