import type { OsmTags, RouteMapGeoJson, RouteSegmentFeature } from "@loopforge/osm-types";
import { getSurfaceStyle, parseOsmTagString } from "@loopforge/osm-types";

function isMicroDegree(value: string | undefined): value is string {
  if (!value || !/^\d+$/.test(value)) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function microToCoord(lon: string, lat: string): [number, number] {
  return [Number(lon) / 1_000_000, Number(lat) / 1_000_000];
}

function isValidCoord([lng, lat]: [number, number]): boolean {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lng === 0 && lat === 0)
  );
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

function tagsForCoordinate(
  coord: [number, number],
  taggedVertices: { coord: [number, number]; tags: OsmTags }[],
): OsmTags {
  let bestTags = taggedVertices[0]?.tags ?? {};
  let bestDist = Infinity;

  for (const vertex of taggedVertices) {
    const dLng = coord[0] - vertex.coord[0];
    const dLat = coord[1] - vertex.coord[1];
    const dist = dLng * dLng + dLat * dLat;
    if (dist < bestDist) {
      bestDist = dist;
      bestTags = vertex.tags;
    }
  }

  return bestTags;
}

function parseTaggedVertices(
  messages: string[][],
): { coord: [number, number]; tags: OsmTags }[] {
  const vertices: { coord: [number, number]; tags: OsmTags }[] = [];
  let lastTags: OsmTags = {};

  for (let i = 1; i < messages.length; i++) {
    const row = messages[i];
    const lon1 = row[0];
    const lat1 = row[1];
    if (!isMicroDegree(lon1) || !isMicroDegree(lat1)) continue;

    const coord = microToCoord(lon1, lat1);
    if (!isValidCoord(coord)) continue;

    const wayTags = row[9] || messages[i - 1]?.[9] || "";
    if (wayTags) {
      lastTags = parseOsmTagString(wayTags);
    }

    vertices.push({ coord, tags: { ...lastTags } });
  }

  return vertices;
}

/**
 * Color the exact BRouter route geometry — every consecutive coordinate pair
 * becomes a segment, so the line always follows paths (no chord shortcuts).
 */
export function buildColoredGeoJsonFromRoute(
  coordinates: [number, number][],
  messages: string[][] | undefined,
): RouteMapGeoJson | null {
  if (coordinates.length < 2) return null;

  const taggedVertices = messages ? parseTaggedVertices(messages) : [];
  if (taggedVertices.length === 0) {
    return buildColoredGeoJson(messages);
  }

  const edges: RouteSegmentFeature[] = [];

  for (let i = 0; i < coordinates.length - 1; i++) {
    const start = coordinates[i];
    const end = coordinates[i + 1];
    if (start[0] === end[0] && start[1] === end[1]) continue;

    const tags = tagsForCoordinate(start, taggedVertices);
    const style = getSurfaceStyle(tags);
    edges.push({
      type: "Feature",
      properties: {
        surface: tags.surface ?? tags.highway ?? "nieznane",
        label: style.label,
        category: style.category,
        color: style.color,
        dash: style.dash,
        highway: tags.highway,
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

/**
 * Builds colored segments edge-by-edge from BRouter message rows.
 * Row 0 is a header — skipped. Only numeric micro-degree coordinates are used.
 */
export function buildColoredGeoJson(
  messages: string[][] | undefined,
): RouteMapGeoJson | null {
  if (!messages || messages.length < 3) return null;

  const edges: RouteSegmentFeature[] = [];
  let lastTags: Record<string, string> = {};

  for (let i = 2; i < messages.length; i++) {
    const previous = messages[i - 1];
    const row = messages[i];
    const lon1 = previous[0];
    const lat1 = previous[1];
    const lon2 = row[0];
    const lat2 = row[1];

    if (
      !isMicroDegree(lon1) ||
      !isMicroDegree(lat1) ||
      !isMicroDegree(lon2) ||
      !isMicroDegree(lat2)
    ) {
      continue;
    }

    const wayTags = row[9] || previous[9] || "";
    const tags = wayTags ? parseOsmTagString(wayTags) : lastTags;
    if (Object.keys(tags).length > 0) {
      lastTags = tags;
    }

    const start = microToCoord(lon1, lat1);
    const end = microToCoord(lon2, lat2);
    if (!isValidCoord(start) || !isValidCoord(end)) continue;
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
