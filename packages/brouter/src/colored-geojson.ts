import type { OsmTags, RouteMapGeoJson, RouteSegmentFeature } from "@loopforge/osm-types";
import { getSurfaceStyle, parseOsmTagString } from "@loopforge/osm-types";

function microToCoord(lon: string, lat: string): [number, number] {
  return [Number(lon) / 1_000_000, Number(lat) / 1_000_000];
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

/**
 * Builds colored segments edge-by-edge from BRouter message rows so geometry
 * matches the routed line exactly (no chord shortcuts on tag changes).
 */
export function buildColoredGeoJson(
  messages: string[][] | undefined,
): RouteMapGeoJson | null {
  if (!messages || messages.length < 2) return null;

  const edges: RouteSegmentFeature[] = [];
  let lastTags: Record<string, string> = {};

  for (let i = 1; i < messages.length; i++) {
    const previous = messages[i - 1];
    const row = messages[i];
    const lon1 = previous[0];
    const lat1 = previous[1];
    const lon2 = row[0];
    const lat2 = row[1];
    if (!lon1 || !lat1 || !lon2 || !lat2) continue;

    const wayTags = row[9] || previous[9] || "";
    const tags = wayTags ? parseOsmTagString(wayTags) : lastTags;
    if (Object.keys(tags).length > 0) {
      lastTags = tags;
    }

    const start = microToCoord(lon1, lat1);
    const end = microToCoord(lon2, lat2);
    if (start[0] === end[0] && start[1] === end[1]) continue;

    const style = getSurfaceStyle(lastTags as OsmTags);
    edges.push({
      type: "Feature",
      properties: {
        surface: lastTags.surface ?? lastTags.highway ?? "nieznane",
        label: style.label,
        category: style.category,
        color: style.color,
        dash: style.dash,
        highway: lastTags.highway,
      },
      geometry: {
        type: "LineString",
        coordinates: [start, end],
      },
    });
  }

  const features = mergeAdjacentFeatures(edges);
  if (features.length === 0) return null;

  return { type: "FeatureCollection", features };
}

export { getSurfaceStyle as colorForSurface } from "@loopforge/osm-types";
