/**
 * Replace long BRouter chords with denser OpenStreetMap way geometry when OSM
 * has intermediate shape nodes that the routing graph omitted / simplified.
 *
 * Fail-open: any network/parse error returns the input unchanged.
 */

import type { RouteMapGeoJson, RouteSegmentFeature } from "@loopforge/osm-types";

type Coord = [number, number];

const EARTH_RADIUS_M = 6_371_000;
const OSM_MAP_API = "https://api.openstreetmap.org/api/0.6/map";
const USER_AGENT = "Loopforge/1.0 (route geometry polish; https://loopforge.pl)";
/** OSM API rejects bboxes larger than 0.25 deg² — keep chunks well under. */
const BBOX_CHUNK_DEG = 0.04;
const MIN_EDGE_M = 28;
const MAX_END_SNAP_M = 10;
const MIN_SHAPE_DEV_M = 1.8;
const MAX_SHAPE_DEV_M = 45;
const MAX_LENGTH_RATIO = 1.35;
const LENGTH_SLACK_M = 25;
const FETCH_TIMEOUT_MS = 8_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineM(a: Coord, b: Coord): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function pathLengthM(coords: Coord[]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    sum += haversineM(coords[i - 1]!, coords[i]!);
  }
  return sum;
}

function nearestIndex(geom: Coord[], p: Coord): { i: number; d: number } {
  let bestI = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < geom.length; i++) {
    const d = haversineM(geom[i]!, p);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return { i: bestI, d: bestD };
}

function maxDeviationFromChordM(slice: Coord[], a: Coord, b: Coord): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const denom = dx * dx + dy * dy + 1e-15;
  let maxDev = 0;
  for (const p of slice) {
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denom),
    );
    const q: Coord = [a[0] + t * dx, a[1] + t * dy];
    maxDev = Math.max(maxDev, haversineM(p, q));
  }
  return maxDev;
}

function parseOsmHighwayWays(xml: string): Coord[][] {
  const nodes = new Map<string, Coord>();
  for (const m of xml.matchAll(
    /<node id="(\d+)"[^>]*lat="([^"]+)" lon="([^"]+)"/g,
  )) {
    nodes.set(m[1]!, [Number(m[3]), Number(m[2])]);
  }

  const ways: Coord[][] = [];
  for (const wm of xml.matchAll(/<way id="(\d+)"[\s\S]*?<\/way>/g)) {
    const block = wm[0]!;
    if (!/k="highway"/.test(block)) continue;
    const nds = [...block.matchAll(/<nd ref="(\d+)"/g)]
      .map((x) => nodes.get(x[1]!))
      .filter((c): c is Coord => c != null);
    if (nds.length >= 3) ways.push(nds);
  }
  return ways;
}

function chunkBboxes(
  coordinates: Coord[],
): Array<{ minLon: number; minLat: number; maxLon: number; maxLat: number }> {
  if (coordinates.length === 0) return [];
  const lons = coordinates.map((c) => c[0]);
  const lats = coordinates.map((c) => c[1]);
  const pad = 0.0008;
  const minLon = Math.min(...lons) - pad;
  const maxLon = Math.max(...lons) + pad;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;

  const boxes: Array<{
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  }> = [];
  for (let lon = minLon; lon < maxLon; lon += BBOX_CHUNK_DEG) {
    for (let lat = minLat; lat < maxLat; lat += BBOX_CHUNK_DEG) {
      boxes.push({
        minLon: lon,
        minLat: lat,
        maxLon: Math.min(maxLon, lon + BBOX_CHUNK_DEG),
        maxLat: Math.min(maxLat, lat + BBOX_CHUNK_DEG),
      });
    }
  }
  return boxes;
}

async function fetchOsmWaysForRoute(
  coordinates: Coord[],
): Promise<Coord[][]> {
  const boxes = chunkBboxes(coordinates);
  if (boxes.length === 0) return [];

  // Cap work on very long loops — first N chunks still cover most chord cuts.
  const limited = boxes.slice(0, 12);
  const ways: Coord[][] = [];

  for (const box of limited) {
    const bbox = `${box.minLon},${box.minLat},${box.maxLon},${box.maxLat}`;
    const response = await fetch(`${OSM_MAP_API}?bbox=${bbox}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) continue;
    const xml = await response.text();
    if (!xml.includes("<osm")) continue;
    ways.push(...parseOsmHighwayWays(xml));
  }

  return ways;
}

function bestShapeReplacement(
  from: Coord,
  to: Coord,
  edgeM: number,
  ways: Coord[][],
): Coord[] | null {
  let best: { slice: Coord[]; score: number } | null = null;

  for (const way of ways) {
    const na = nearestIndex(way, from);
    const nb = nearestIndex(way, to);
    if (na.d > MAX_END_SNAP_M || nb.d > MAX_END_SNAP_M) continue;
    if (Math.abs(na.i - nb.i) < 2) continue;

    const slice =
      na.i <= nb.i
        ? way.slice(na.i, nb.i + 1)
        : way.slice(nb.i, na.i + 1).reverse();
    if (slice.length < 3) continue;

    const routedM = pathLengthM(slice);
    if (routedM > edgeM * MAX_LENGTH_RATIO + LENGTH_SLACK_M) continue;

    const maxDev = maxDeviationFromChordM(slice, from, to);
    if (maxDev < MIN_SHAPE_DEV_M || maxDev > MAX_SHAPE_DEV_M) continue;

    // Prefer more shape points with moderate bulge (real curves, not detours).
    const score = slice.length * 10 + maxDev;
    if (!best || score > best.score) {
      best = { slice, score };
    }
  }

  if (!best) return null;
  // Keep BRouter endpoints exact; only inject intermediate OSM shape nodes.
  return [from, ...best.slice.slice(1, -1), to];
}

/**
 * Pure enrichment against a preloaded way list — exported for unit tests.
 */
export function enrichCoordinatesWithWays(
  coordinates: Coord[],
  ways: Coord[][],
): { coordinates: Coord[]; enrichedEdges: number } {
  if (coordinates.length < 2 || ways.length === 0) {
    return { coordinates, enrichedEdges: 0 };
  }

  const out: Coord[] = [coordinates[0]!];
  let enrichedEdges = 0;

  for (let i = 1; i < coordinates.length; i++) {
    const from = coordinates[i - 1]!;
    const to = coordinates[i]!;
    const edgeM = haversineM(from, to);
    if (edgeM < MIN_EDGE_M) {
      out.push(to);
      continue;
    }

    const replacement = bestShapeReplacement(from, to, edgeM, ways);
    if (replacement && replacement.length > 2) {
      out.push(...replacement.slice(1));
      enrichedEdges += 1;
    } else {
      out.push(to);
    }
  }

  return { coordinates: out, enrichedEdges };
}

/**
 * Fetch OSM highway geometries near the route and splice denser shape nodes
 * into long chords. Returns the original polyline if anything fails.
 */
export async function enrichRouteShapesFromOsm(
  coordinates: Coord[],
): Promise<{ coordinates: Coord[]; enrichedEdges: number }> {
  if (coordinates.length < 3) {
    return { coordinates, enrichedEdges: 0 };
  }

  try {
    const ways = await fetchOsmWaysForRoute(coordinates);
    if (ways.length === 0) return { coordinates, enrichedEdges: 0 };
    return enrichCoordinatesWithWays(coordinates, ways);
  } catch {
    return { coordinates, enrichedEdges: 0 };
  }
}

function distPointToSegmentM(p: Coord, a: Coord, b: Coord): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const denom = dx * dx + dy * dy + 1e-15;
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denom),
  );
  return haversineM(p, [a[0] + t * dx, a[1] + t * dy]);
}

function nearestStyledFeature(
  point: Coord,
  features: RouteSegmentFeature[],
): RouteSegmentFeature | null {
  let best: RouteSegmentFeature | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const feature of features) {
    const coords = feature.geometry.coordinates as Coord[];
    for (let i = 1; i < coords.length; i++) {
      const d = distPointToSegmentM(point, coords[i - 1]!, coords[i]!);
      if (d < bestD) {
        bestD = d;
        best = feature;
      }
    }
  }
  return best;
}

/**
 * Paint a polished polyline using surface styles from the pre-polish overlay.
 * Never call buildRouteMapGeoJson without BRouter messages — empty tags become
 * the purple "Inne / brak tagu OSM" style for the whole loop.
 */
export function recolorCoordinatesFromMapGeojson(
  coordinates: Coord[],
  source: RouteMapGeoJson | undefined,
): RouteMapGeoJson | undefined {
  if (coordinates.length < 2 || !source?.features.length) return source;

  const edges: RouteSegmentFeature[] = [];
  let lastProps: RouteSegmentFeature["properties"] | null = null;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const start = coordinates[i]!;
    const end = coordinates[i + 1]!;
    if (start[0] === end[0] && start[1] === end[1]) continue;

    const mid: Coord = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const nearest = nearestStyledFeature(mid, source.features);
    const props: RouteSegmentFeature["properties"] | null =
      nearest?.properties ?? lastProps;
    if (!props) continue;
    lastProps = props;

    edges.push({
      type: "Feature",
      properties: { ...props },
      geometry: {
        type: "LineString",
        coordinates: [start, end],
      },
    });
  }

  if (edges.length === 0) return source;

  // Merge adjacent edges that share the same style key.
  const merged: RouteSegmentFeature[] = [
    {
      ...edges[0]!,
      geometry: {
        type: "LineString",
        coordinates: [...edges[0]!.geometry.coordinates],
      },
    },
  ];
  for (let i = 1; i < edges.length; i++) {
    const current = edges[i]!;
    const previous = merged[merged.length - 1]!;
    const sameStyle =
      previous.properties.label === current.properties.label &&
      previous.properties.color === current.properties.color &&
      previous.properties.category === current.properties.category &&
      previous.properties.leg === current.properties.leg;
    const last = previous.geometry.coordinates.at(-1) as Coord | undefined;
    const first = current.geometry.coordinates[0] as Coord | undefined;
    const contiguous =
      last &&
      first &&
      Math.abs(last[0] - first[0]) < 1e-6 &&
      Math.abs(last[1] - first[1]) < 1e-6;

    if (sameStyle && contiguous) {
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

  return { type: "FeatureCollection", features: merged };
}
