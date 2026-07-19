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

/** Dense route polyline from BRouter message rows (full vertex detail). */
export function extractRouteCoordinatesFromMessages(
  messages: string[][] | undefined,
): [number, number][] {
  if (!messages || messages.length < 2) return [];

  const coords: [number, number][] = [];
  for (let i = 1; i < messages.length; i++) {
    const row = messages[i];
    const lon = row[0];
    const lat = row[1];
    if (!isMicroDegree(lon) || !isMicroDegree(lat)) continue;

    const coord = microToCoord(lon, lat);
    if (!isValidCoord(coord)) continue;

    const last = coords.at(-1);
    if (last && last[0] === coord[0] && last[1] === coord[1]) continue;
    coords.push(coord);
  }

  return coords;
}

/**
 * Prefer BRouter GeoJSON shape points over message vertices.
 * Messages are sparse (mostly graph nodes) and draw air-chords across curves/fields.
 */
export function pickDensestRouteCoordinates(
  geojsonCoords: [number, number][],
  messages: string[][] | undefined,
): [number, number][] {
  if (geojsonCoords.length >= 2) return geojsonCoords;
  return extractRouteCoordinatesFromMessages(messages);
}

export function buildRouteMapGeoJson(
  coordinates: [number, number][],
  messages: string[][] | undefined,
): RouteMapGeoJson | null {
  if (coordinates.length >= 2) {
    return buildColoredGeoJsonFromRoute(coordinates, messages);
  }
  return buildColoredGeoJson(messages);
}

function haversineM(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Absolute teleport — never paint these on the map. */
const HARD_MAP_TELEPORT_M = 1200;

/**
 * Omit only clear air-chords in dense street fabric.
 * Rural BRouter legs routinely span 100–400 m; a flat ~95 m cap shredded
 * those loops into dashed fragments.
 */
function shouldOmitMapEdge(
  edgeM: number,
  edgeLengths: number[],
  index: number,
): boolean {
  if (edgeM > HARD_MAP_TELEPORT_M) return true;
  if (edgeM < 140) return false;

  const window = 12;
  const nearby: number[] = [];
  for (
    let j = Math.max(0, index - window);
    j < Math.min(edgeLengths.length, index + window + 1);
    j++
  ) {
    if (j !== index) nearby.push(edgeLengths[j]!);
  }
  if (nearby.length < 4) {
    return edgeM > 600;
  }

  const sorted = [...nearby].sort((a, b) => a - b);
  const localMed = sorted[Math.floor(sorted.length / 2)]!;
  // Dense town: hide rail/roundabout diagonals over short neighbouring edges.
  if (localMed > 0 && localMed < 40 && edgeM > Math.max(140, localMed * 6)) {
    return true;
  }
  // Mixed fabric: only strong local outliers.
  if (localMed > 0 && localMed < 70 && edgeM > Math.max(220, localMed * 7)) {
    return true;
  }
  return edgeM > 800;
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
  const edgeLengths: number[] = [];
  for (let i = 0; i < coordinates.length - 1; i++) {
    edgeLengths.push(haversineM(coordinates[i]!, coordinates[i + 1]!));
  }

  const edges: RouteSegmentFeature[] = [];

  for (let i = 0; i < coordinates.length - 1; i++) {
    const start = coordinates[i]!;
    const end = coordinates[i + 1]!;
    if (start[0] === end[0] && start[1] === end[1]) continue;
    if (shouldOmitMapEdge(edgeLengths[i]!, edgeLengths, i)) continue;

    const tags =
      taggedVertices.length > 0
        ? tagsForCoordinate(start, taggedVertices)
        : ({} as OsmTags);
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
 * Builds colored segments edge-by-edge from consecutive BRouter vertices.
 * Row 0 is a header — skipped. Only numeric micro-degree coordinates are used.
 */
export function buildColoredGeoJson(
  messages: string[][] | undefined,
): RouteMapGeoJson | null {
  const vertices = messages ? parseTaggedVertices(messages) : [];
  if (vertices.length < 2) return null;

  const edges: RouteSegmentFeature[] = [];

  for (let i = 1; i < vertices.length; i++) {
    const start = vertices[i - 1]!.coord;
    const end = vertices[i]!.coord;
    if (start[0] === end[0] && start[1] === end[1]) continue;

    const tags = vertices[i]!.tags;
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

export { getSurfaceStyle as colorForSurface } from "@loopforge/osm-types";
