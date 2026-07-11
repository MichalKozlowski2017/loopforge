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

    if (styleKey(previous) === styleKey(current)) {
      const last = previous.geometry.coordinates.at(-1);
      const first = current.geometry.coordinates[0];
      const rest =
        last && first && last[0] === first[0] && last[1] === first[1]
          ? current.geometry.coordinates.slice(1)
          : current.geometry.coordinates;
      previous.geometry.coordinates.push(...rest);
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
