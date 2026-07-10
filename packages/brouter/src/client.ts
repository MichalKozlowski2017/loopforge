import type { BikeType, Direction, LatLng, OsmTags, RouteMapGeoJson } from "@loopforge/osm-types";
import { getSurfaceStyle } from "@loopforge/osm-types";
import type { BrouterConfig } from "./config";
import { buildColoredGeoJson } from "./colored-geojson";
import { ensureBrouterServer } from "./server";

const DIRECTION_BEARING: Record<Direction, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

const BIKE_PROFILE: Record<BikeType, string> = {
  gravel: "gravel",
  road: "fastbike",
  mtb: "mtb",
  general: "trekking",
};

export interface RoundTripParams {
  start: LatLng;
  bikeType: BikeType;
  distanceKm: number;
  direction: Direction;
}

export interface BrouterRouteResult {
  coordinates: [number, number][];
  distanceKm: number;
  elevationGainM: number;
  segments: { tags: OsmTags; distanceM: number }[];
  mapGeojson: RouteMapGeoJson | null;
  gpx: string;
}

interface BrouterGeoJson {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, string | string[][]>;
    geometry: {
      type: "LineString";
      coordinates: [number, number][];
    };
  }>;
}

function parseWayTags(raw: string): OsmTags {
  const tags: OsmTags = {};
  for (const part of raw.split(" ")) {
    const [key, value] = part.split("=");
    if (!key || !value) continue;
    if (key === "highway") tags.highway = value;
    if (key === "surface") tags.surface = value;
    if (key === "tracktype") tags.tracktype = value;
    if (key === "mtb:scale") tags["mtb:scale"] = value;
  }
  return tags;
}

function parseSegmentsFromMessages(
  messages: string[][] | undefined,
): { tags: OsmTags; distanceM: number }[] {
  if (!messages || messages.length < 2) return [];

  const segments: { tags: OsmTags; distanceM: number }[] = [];
  for (let i = 1; i < messages.length; i++) {
    const row = messages[i];
    const distanceM = Number(row[3] ?? 0);
    const wayTags = row[9] ?? "";
    if (!wayTags || distanceM <= 0) continue;
    segments.push({ tags: parseWayTags(wayTags), distanceM });
  }
  return segments;
}

function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function distanceFromCoordinates(coords: [number, number][]): number {
  let meters = 0;
  for (let i = 1; i < coords.length; i++) {
    meters += haversineM(
      { lng: coords[i - 1][0], lat: coords[i - 1][1] },
      { lng: coords[i][0], lat: coords[i][1] },
    );
  }
  return meters;
}

function surfaceBreakdownFromSegments(
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

async function fetchRoundTripAttempt(
  config: BrouterConfig,
  params: RoundTripParams,
  roundTripPoints: number,
): Promise<BrouterRouteResult> {
  const legDistanceM = Math.max(
    3000,
    Math.round((params.distanceKm * 1000) / roundTripPoints),
  );
  const lonlats = `${params.start.lng},${params.start.lat}|${params.start.lng},${params.start.lat}`;
  const query = new URLSearchParams({
    lonlats,
    profile: BIKE_PROFILE[params.bikeType],
    engineMode: "4",
    roundTripDistance: String(legDistanceM),
    roundTripPoints: String(roundTripPoints),
    direction: String(DIRECTION_BEARING[params.direction]),
    format: "geojson",
  });

  const response = await fetch(`${config.baseUrl}/brouter?${query.toString()}`, {
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.trim() || `BRouter HTTP ${response.status}`);
  }

  const geojson = (await response.json()) as BrouterGeoJson;
  const feature = geojson.features[0];
  if (!feature?.geometry?.coordinates?.length) {
    throw new Error("BRouter returned an empty route");
  }

  const coordinates = feature.geometry.coordinates.filter(
    ([lng, lat]) =>
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      Math.abs(lat) <= 90 &&
      !(lng === 0 && lat === 0),
  );
  if (coordinates.length < 2) {
    throw new Error("BRouter returned invalid route coordinates");
  }
  const messages = feature.properties.messages as string[][] | undefined;
  const segments = parseSegmentsFromMessages(messages);
  const mapGeojson = buildColoredGeoJson(messages);
  const distanceKm = distanceFromCoordinates(coordinates) / 1000;
  const elevationGainM = Number(feature.properties["filtered ascend"] ?? 0);

  const gpxResponse = await fetch(
    `${config.baseUrl}/brouter?${new URLSearchParams({
      ...Object.fromEntries(query),
      format: "gpx",
      trackname: `Loopforge ${params.bikeType}`,
    }).toString()}`,
    { signal: AbortSignal.timeout(120_000) },
  );

  const gpx = gpxResponse.ok ? await gpxResponse.text() : "";

  return {
    coordinates,
    distanceKm,
    elevationGainM,
    segments,
    mapGeojson,
    gpx,
  };
}

export async function fetchRoundTrip(
  config: BrouterConfig,
  params: RoundTripParams,
): Promise<BrouterRouteResult> {
  await ensureBrouterServer(config);

  const pointOptions = [5, 4, 6];
  let lastError: Error | null = null;

  for (const points of pointOptions) {
    try {
      return await fetchRoundTripAttempt(config, params, points);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("BRouter round trip failed");
}

export { surfaceBreakdownFromSegments };
