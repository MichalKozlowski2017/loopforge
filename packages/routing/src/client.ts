import type {
  BikeType,
  LatLng,
  OsmTags,
  RideProfile,
  RouteMapGeoJson,
} from "@loopforge/osm-types";
import { buildGpx } from "@loopforge/gpx";
import {
  buildColoredGeoJsonFromSegments,
  hstoreRowToTags,
  surfaceBreakdownFromSegments,
} from "./colored-geojson";
import { costColumnForBikeType, getRoutingConfig, type RoutingConfig } from "./config";
import { withClient } from "./db";

export interface RoutingRouteResult {
  coordinates: [number, number][];
  distanceKm: number;
  elevationGainM: number;
  segments: { tags: OsmTags; distanceM: number }[];
  mapGeojson: RouteMapGeoJson;
  gpx: string;
}

export interface WaypointRouteParams {
  start: LatLng;
  bikeType: BikeType;
  waypoints: LatLng[];
  rideProfile?: RideProfile;
  skipGpx?: boolean;
}

interface EdgeRow {
  id: string;
  length_m: number;
  tags: Record<string, string | null>;
  geojson: {
    type: "LineString";
    coordinates: [number, number][];
  };
}

interface DijkstraRow {
  edge: string | null;
}

const EARTH_RADIUS_M = 6_371_000;

function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function appendCoordinates(
  target: [number, number][],
  incoming: [number, number][],
): void {
  if (incoming.length === 0) return;
  if (target.length === 0) {
    target.push(...incoming);
    return;
  }
  const last = target[target.length - 1];
  const first = incoming[0];
  if (last[0] === first[0] && last[1] === first[1]) {
    target.push(...incoming.slice(1));
  } else {
    target.push(...incoming);
  }
}

async function nearestVertex(
  client: import("pg").PoolClient,
  point: LatLng,
): Promise<number> {
  const result = await client.query<{ id: string }>(
    `select loopforge.nearest_vertex($1, $2)::text as id`,
    [point.lng, point.lat],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("No routing vertex near start point");
  return Number(id);
}

async function dijkstraEdges(
  client: import("pg").PoolClient,
  fromVid: number,
  toVid: number,
  bikeType: BikeType,
): Promise<number[]> {
  const costCol = costColumnForBikeType(bikeType);
  const edgeSql = `SELECT id, source, target, ${costCol} AS cost, ${costCol} AS reverse_cost FROM loopforge.ways WHERE ${costCol} < 1e9`;
  const result = await client.query<DijkstraRow>(
    `
      select edge::text
      from pgr_dijkstra(
        $3::text,
        $1::bigint,
        $2::bigint,
        directed := false
      )
      where edge <> -1
    `,
    [fromVid, toVid, edgeSql],
  );
  return result.rows
    .map((row) => Number(row.edge))
    .filter((edge) => Number.isFinite(edge) && edge > 0);
}

async function fetchEdges(
  client: import("pg").PoolClient,
  edgeIds: number[],
): Promise<Map<number, EdgeRow>> {
  if (edgeIds.length === 0) return new Map();

  const result = await client.query<EdgeRow>(
    `
      select
        id::text,
        length_m,
        hstore_to_json(tags)::jsonb as tags,
        st_asgeojson(geom)::json as geojson
      from loopforge.ways
      where id = any($1::bigint[])
    `,
    [edgeIds],
  );

  const map = new Map<number, EdgeRow>();
  for (const row of result.rows) {
    map.set(Number(row.id), row);
  }
  return map;
}

function tagsFromEdgeRow(row: EdgeRow): OsmTags {
  return hstoreRowToTags(row.tags);
}

async function routeSegment(
  client: import("pg").PoolClient,
  from: LatLng,
  to: LatLng,
  bikeType: BikeType,
): Promise<{
  coordinates: [number, number][];
  segments: { tags: OsmTags; distanceM: number; coordinates: [number, number][] }[];
  distanceM: number;
}> {
  const fromVid = await nearestVertex(client, from);
  const toVid = await nearestVertex(client, to);
  if (fromVid === toVid) {
    return { coordinates: [[from.lng, from.lat]], segments: [], distanceM: 0 };
  }

  const edgeIds = await dijkstraEdges(client, fromVid, toVid, bikeType);
  if (edgeIds.length === 0) {
    throw new Error("pgRouting returned no edges between waypoints");
  }

  const edges = await fetchEdges(client, edgeIds);
  const coordinates: [number, number][] = [];
  const segments: {
    tags: OsmTags;
    distanceM: number;
    coordinates: [number, number][];
  }[] = [];
  let distanceM = 0;

  for (const edgeId of edgeIds) {
    const edge = edges.get(edgeId);
    if (!edge?.geojson?.coordinates?.length) continue;

    const edgeCoords = edge.geojson.coordinates;
    appendCoordinates(coordinates, edgeCoords);

    const tags = tagsFromEdgeRow(edge);
    segments.push({
      tags,
      distanceM: edge.length_m,
      coordinates: edgeCoords,
    });
    distanceM += edge.length_m;
  }

  return { coordinates, segments, distanceM };
}

export async function isRoutingReady(config?: RoutingConfig): Promise<boolean> {
  const resolved = config ?? getRoutingConfig();
  if (!resolved) return false;

  try {
    return await withClient(resolved, async (client) => {
      const result = await client.query<{ count: string }>(
        `select count(*)::text as count from loopforge.ways`,
      );
      return Number(result.rows[0]?.count ?? 0) > 0;
    });
  } catch {
    return false;
  }
}

export async function fetchRouteThroughWaypoints(
  params: WaypointRouteParams,
  config?: RoutingConfig,
): Promise<RoutingRouteResult> {
  const resolved = config ?? getRoutingConfig();
  if (!resolved) {
    throw new Error("DATABASE_URL is not configured");
  }

  const loop = [params.start, ...params.waypoints, params.start];
  const allCoordinates: [number, number][] = [];
  const allSegments: {
    tags: OsmTags;
    distanceM: number;
    coordinates: [number, number][];
  }[] = [];
  let totalDistanceM = 0;

  await withClient(resolved, async (client) => {
    for (let i = 0; i < loop.length - 1; i++) {
      const segment = await routeSegment(
        client,
        loop[i],
        loop[i + 1],
        params.bikeType,
      );
      appendCoordinates(allCoordinates, segment.coordinates);
      allSegments.push(...segment.segments);
      totalDistanceM += segment.distanceM;
    }
  });

  if (allCoordinates.length < 2) {
    throw new Error("pgRouting returned an empty route");
  }

  const segmentsForScoring = allSegments.map(({ tags, distanceM }) => ({
    tags,
    distanceM,
  }));
  const mapGeojson = buildColoredGeoJsonFromSegments(allSegments);
  const trackName = `Loopforge ${params.bikeType}`;

  return {
    coordinates: allCoordinates,
    distanceKm: totalDistanceM / 1000,
    elevationGainM: 0,
    segments: segmentsForScoring,
    mapGeojson,
    gpx: params.skipGpx
      ? ""
      : buildGpx(trackName, allCoordinates, params.start),
  };
}

export { surfaceBreakdownFromSegments };
