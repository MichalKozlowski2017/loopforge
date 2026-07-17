import type {
  BikeType,
  Direction,
  LatLng,
  OsmTags,
  RideProfile,
  RouteMapGeoJson,
} from "@loopforge/osm-types";
import { getSurfaceStyle } from "@loopforge/osm-types";
import type { BrouterConfig } from "./config";
import { buildColoredGeoJsonFromRoute } from "./colored-geojson";
import { ensureBrouterServer, restartBrouterServer } from "./server";

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

const MTB_CUSTOM_PROFILE = "customprofiles/loopforge-mtb";
const MTB_STOCK_PROFILE = "mtb";

/** Paved, direct routing for the approach leg — uses stock fastbike (custom fastbike clones fail in customprofiles). */
export const APPROACH_BROUTER_PROFILE = "fastbike";
const APPROACH_FALLBACK_PROFILE = "trekking";
const BROUTER_FETCH_TIMEOUT_MS = 45_000;

function isLocalBrouter(config: BrouterConfig): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(
    config.baseUrl,
  );
}

async function fetchBrouterWithRetry(
  config: BrouterConfig,
  url: string,
): Promise<Response> {
  try {
    return await fetch(url, {
      signal: AbortSignal.timeout(BROUTER_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    if (!isTimeout || !isLocalBrouter(config)) throw error;
    await restartBrouterServer(config);
    return fetch(url, {
      signal: AbortSignal.timeout(BROUTER_FETCH_TIMEOUT_MS),
    });
  }
}

const BIKE_PROFILE: Record<BikeType, string> = {
  gravel: "customprofiles/loopforge-gravel",
  road: "fastbike",
  mtb: MTB_CUSTOM_PROFILE,
  general: "customprofiles/loopforge-trekking",
};

const ROAD_PROFILE: Record<RideProfile, string[]> = {
  fast: ["fastbike"],
  flow: ["fastbike-lowtraffic", "fastbike"],
  technical: ["fastbike-verylowtraffic", "fastbike-lowtraffic", "fastbike"],
};

function profilesForRequest(
  bikeType: BikeType,
  rideProfile?: RideProfile,
  preferQuietRoutes?: boolean,
): string[] {
  if (bikeType === "mtb") {
    return [MTB_CUSTOM_PROFILE, MTB_STOCK_PROFILE];
  }
  if (bikeType === "road") {
    if (preferQuietRoutes) {
      return ["fastbike-verylowtraffic", "fastbike-lowtraffic", "fastbike"];
    }
    return ROAD_PROFILE[rideProfile ?? "fast"];
  }
  if (bikeType === "gravel") {
    if (preferQuietRoutes) {
      return [
        BIKE_PROFILE.gravel,
        "trekking",
        "fastbike-verylowtraffic",
        "fastbike-lowtraffic",
        "fastbike",
      ];
    }
    return [
      BIKE_PROFILE.gravel,
      "trekking",
      "fastbike-lowtraffic",
      "fastbike",
    ];
  }
  if (preferQuietRoutes) {
    return [
      BIKE_PROFILE.general,
      "trekking",
      "fastbike-verylowtraffic",
      "fastbike-lowtraffic",
    ];
  }
  return [BIKE_PROFILE.general, "trekking", "fastbike-lowtraffic"];
}

function isRetryableRoutingError(message: string): boolean {
  return /target island|island detected|not reachable|cannot find a route|routing failed|endpoint not found/i.test(
    message,
  );
}

function brouterProfileOverrides(
  bikeType: BikeType,
  rideProfile?: RideProfile,
  avoidAsphalt?: boolean,
  profileName?: string,
  urbanRouting?: boolean,
  closedLoop?: boolean,
  preferQuietRoutes?: boolean,
): Record<string, string> {
  const overrides: Record<string, string> = {
    allow_ferries: "0",
  };

  if (closedLoop) {
    // Closed loops (start = end) — via correction cuts valid loop legs as "detours".
    overrides.correctMisplacedViaPoints = "0";
  } else {
    overrides.correctMisplacedViaPoints = "1";
    overrides.correctMisplacedViaPointsDistance = urbanRouting ? "3200" : "1200";
  }

  if (bikeType === "gravel" || bikeType === "general") {
    if (rideProfile === "technical") {
      overrides.prefer_unpaved_paths = "1";
      overrides.prefer_forests = "1";
      overrides.avoid_towns = "1";
      overrides.prefer_rivers = "1";
      overrides.consider_elevation = "1";
    } else if (rideProfile === "fast") {
      if (bikeType === "gravel") {
        // Express = fast compacted/gravel (e.g. Wisła towpaths), not paved shortcuts.
        overrides.prefer_unpaved_paths = "1";
        overrides.prefer_cycle_routes = "1";
        overrides.prefer_rivers = "1";
        overrides.avoid_steep_inclines = "1";
      } else {
        overrides.prefer_unpaved_paths = "0";
        overrides.prefer_cycle_routes = "1";
        overrides.avoid_steep_inclines = "1";
      }
    } else {
      overrides.prefer_unpaved_paths = "1";
      overrides.prefer_cycle_routes = "1";
    }
  }

  if (bikeType === "mtb") {
    const customMtb = (profileName ?? MTB_CUSTOM_PROFILE) === MTB_CUSTOM_PROFILE;
    if (rideProfile === "technical") {
      overrides.path_preference = "32";
    } else if (rideProfile === "fast") {
      overrides.path_preference = "10";
      overrides.smallpaved_factor = "-0.8";
    } else if (rideProfile === "flow") {
      overrides.path_preference = "22";
      overrides.smallpaved_factor = "-1.2";
    }

    if (avoidAsphalt) {
      overrides.smallpaved_factor = "-2";
      overrides.path_preference = "32";
      if (customMtb) {
        overrides.avoid_footways = "1";
      } else {
        // Stock mtb profile — no avoid_footways tunable; block foot-only ways.
        overrides.StrictNOBicycleaccess = "1";
      }
    }
  }

  if (
    avoidAsphalt &&
    (bikeType === "gravel" || bikeType === "general")
  ) {
    overrides.avoid_footways = "1";
    overrides.prefer_unpaved_paths = "1";
    overrides.prefer_forests = "1";
  }

  if (preferQuietRoutes) {
    if (bikeType === "gravel" || bikeType === "general") {
      overrides.prefer_cycle_routes = "1";
    }
    if (bikeType === "general") {
      overrides.avoid_unsafe = "1";
    }
    if (bikeType === "mtb") {
      const pavedFactor = Number(overrides.smallpaved_factor ?? "0");
      overrides.smallpaved_factor = String(Math.min(pavedFactor, -1.2));
    }
  }

  return overrides;
}

function buildBrouterQuery(
  bikeType: BikeType,
  lonlats: string,
  profileName: string,
  rideProfile?: RideProfile,
  avoidAsphalt?: boolean,
  urbanRouting?: boolean,
  closedLoop?: boolean,
  preferQuietRoutes?: boolean,
): URLSearchParams {
  const query = new URLSearchParams({
    lonlats,
    profile: profileName,
    format: "geojson",
  });

  for (const [key, value] of Object.entries(
    brouterProfileOverrides(
      bikeType,
      rideProfile,
      avoidAsphalt,
      profileName,
      urbanRouting,
      closedLoop,
      preferQuietRoutes,
    ),
  )) {
    query.set(`profile:${key}`, value);
  }

  return query;
}

function buildApproachBrouterQuery(
  lonlats: string,
  profileName: string,
): URLSearchParams {
  const query = new URLSearchParams({
    lonlats,
    profile: profileName,
    format: "geojson",
  });
  query.set("profile:correctMisplacedViaPoints", "1");
  query.set("profile:correctMisplacedViaPointsDistance", "1200");
  query.set("profile:allow_ferries", "0");
  return query;
}

async function fetchApproachBrouterRoute(
  config: BrouterConfig,
  points: LatLng[],
  trackName: string,
  skipGpx = true,
): Promise<BrouterRouteResult> {
  const lonlats = points.map((p) => `${p.lng},${p.lat}`).join("|");
  const profiles = [APPROACH_BROUTER_PROFILE, APPROACH_FALLBACK_PROFILE];
  let lastError: Error | null = null;

  for (let i = 0; i < profiles.length; i++) {
    const profileName = profiles[i]!;
    const query = buildApproachBrouterQuery(lonlats, profileName);

    const response = await fetchBrouterWithRetry(
      config,
      `${config.baseUrl}/brouter?${query.toString()}`,
    );

    if (!response.ok) {
      const text = await response.text();
      lastError = new Error(text.trim() || `BRouter HTTP ${response.status}`);
      const retryable =
        isRetryableRoutingError(text) ||
        response.status === 500 ||
        response.status === 400;
      if (retryable && i < profiles.length - 1) continue;
      throw lastError;
    }

    const geojson = (await response.json()) as BrouterGeoJson;
    const feature = geojson.features[0];
    if (!feature?.geometry?.coordinates?.length) {
      lastError = new Error("BRouter returned an empty route");
      if (i < profiles.length - 1) continue;
      throw lastError;
    }

    const coordinates = filterCoordinates(feature.geometry.coordinates);
    if (coordinates.length < 2) {
      lastError = new Error("BRouter returned invalid route coordinates");
      if (i < profiles.length - 1) continue;
      throw lastError;
    }

    const messages = feature.properties.messages as string[][] | undefined;
    const segments = parseSegmentsFromMessages(messages);
    const mapGeojson = buildColoredGeoJsonFromRoute(coordinates, messages);
    const distanceKm = distanceFromCoordinates(coordinates) / 1000;
    const elevationGainM = Number(feature.properties["filtered ascend"] ?? 0);

    let gpx = "";
    if (!skipGpx) {
      const gpxResponse = await fetch(
        `${config.baseUrl}/brouter?${new URLSearchParams({
          ...Object.fromEntries(query),
          format: "gpx",
          trackname: trackName,
        }).toString()}`,
        { signal: AbortSignal.timeout(45_000) },
      );
      gpx = gpxResponse.ok ? await gpxResponse.text() : "";
    }

    return {
      coordinates,
      distanceKm,
      elevationGainM,
      segments,
      mapGeojson,
      gpx,
    };
  }

  throw lastError ?? new Error("BRouter approach request failed");
}

export interface RoundTripParams {
  start: LatLng;
  bikeType: BikeType;
  distanceKm: number;
  direction: Direction;
}

export interface WaypointRouteParams {
  start: LatLng;
  bikeType: BikeType;
  waypoints: LatLng[];
  rideProfile?: RideProfile;
  avoidAsphalt?: boolean;
  /** Prefer cycleways and low-traffic streets over busy car roads. */
  preferQuietRoutes?: boolean;
  /** Looser via-point correction for dense urban road grids. */
  urbanRouting?: boolean;
  /** Skip extra GPX request — use buildGpx() on the client/generator side. */
  skipGpx?: boolean;
}

export interface BrouterRouteResult {
  coordinates: [number, number][];
  distanceKm: number;
  elevationGainM: number;
  segments: { tags: OsmTags; distanceM: number }[];
  mapGeojson: RouteMapGeoJson | null;
  gpx: string;
  /** Raw BRouter message rows — used to recolor geometry after post-processing. */
  brouterMessages?: string[][];
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
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === "highway") tags.highway = value;
    if (key === "surface") tags.surface = value;
    if (key === "route") tags.route = value;
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

function filterCoordinates(coords: number[][]): [number, number][] {
  const normalized: [number, number][] = [];
  for (const coord of coords) {
    const lng = coord[0];
    const lat = coord[1];
    if (
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      Math.abs(lat) <= 90 &&
      !(lng === 0 && lat === 0)
    ) {
      normalized.push([lng, lat]);
    }
  }
  return normalized;
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

async function fetchBrouterRoute(
  config: BrouterConfig,
  bikeType: BikeType,
  points: LatLng[],
  trackName: string,
  options?: {
    skipGpx?: boolean;
    rideProfile?: RideProfile;
    avoidAsphalt?: boolean;
    preferQuietRoutes?: boolean;
    urbanRouting?: boolean;
    /** Route returns to its first point (loop) — disable via-point detour stripping. */
    closedLoop?: boolean;
  },
): Promise<BrouterRouteResult> {
  const lonlats = points.map((p) => `${p.lng},${p.lat}`).join("|");
  const profiles = profilesForRequest(
    bikeType,
    options?.rideProfile,
    options?.preferQuietRoutes,
  );
  let lastError: Error | null = null;

  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i]!;
    const query = buildBrouterQuery(
      bikeType,
      lonlats,
      profile,
      options?.rideProfile,
      options?.avoidAsphalt,
      options?.urbanRouting,
      options?.closedLoop,
      options?.preferQuietRoutes,
    );

    const response = await fetchBrouterWithRetry(
      config,
      `${config.baseUrl}/brouter?${query.toString()}`,
    );

    if (!response.ok) {
      const text = await response.text();
      lastError = new Error(text.trim() || `BRouter HTTP ${response.status}`);
      const retryable =
        isRetryableRoutingError(text) ||
        response.status === 500 ||
        response.status === 400;
      if (retryable && i < profiles.length - 1) continue;
      throw lastError;
    }

    const geojson = (await response.json()) as BrouterGeoJson;
    const feature = geojson.features[0];
    if (!feature?.geometry?.coordinates?.length) {
      lastError = new Error("BRouter returned an empty route");
      if (i < profiles.length - 1) continue;
      throw lastError;
    }

    const coordinates = filterCoordinates(feature.geometry.coordinates);
    if (coordinates.length < 2) {
      lastError = new Error("BRouter returned invalid route coordinates");
      if (i < profiles.length - 1) continue;
      throw lastError;
    }

    const messages = feature.properties.messages as string[][] | undefined;
    const segments = parseSegmentsFromMessages(messages);
    const mapGeojson = buildColoredGeoJsonFromRoute(coordinates, messages);
    const distanceKm = distanceFromCoordinates(coordinates) / 1000;
    const elevationGainM = Number(feature.properties["filtered ascend"] ?? 0);

    let gpx = "";
    if (!options?.skipGpx) {
      const gpxResponse = await fetch(
        `${config.baseUrl}/brouter?${new URLSearchParams({
          ...Object.fromEntries(query),
          format: "gpx",
          trackname: trackName,
        }).toString()}`,
        { signal: AbortSignal.timeout(45_000) },
      );
      gpx = gpxResponse.ok ? await gpxResponse.text() : "";
    }

    return {
      coordinates,
      distanceKm,
      elevationGainM,
      segments,
      mapGeojson,
      gpx,
      brouterMessages: messages,
    };
  }

  throw lastError ?? new Error("BRouter request failed");
}

/** Route approach leg on paved roads (loopforge-approach), ignoring loop bike type. */
export async function fetchApproachRouteBetweenPoints(
  config: BrouterConfig,
  params: {
    from: LatLng;
    to: LatLng;
    skipGpx?: boolean;
  },
): Promise<BrouterRouteResult> {
  await ensureBrouterServer(config);
  return fetchApproachBrouterRoute(
    config,
    [params.from, params.to],
    "Loopforge dojazd",
    params.skipGpx ?? true,
  );
}

/** Route approach through corridor waypoints in one BRouter request. */
export async function fetchApproachRouteThroughPoints(
  config: BrouterConfig,
  params: {
    points: LatLng[];
    skipGpx?: boolean;
  },
): Promise<BrouterRouteResult> {
  await ensureBrouterServer(config);
  if (params.points.length < 2) {
    throw new Error("Approach route needs at least two points");
  }
  return fetchApproachBrouterRoute(
    config,
    params.points,
    "Loopforge dojazd",
    params.skipGpx ?? true,
  );
}

/** Route between two points — uses the loop bike profile and ride preferences. */
export async function fetchRouteBetweenPoints(
  config: BrouterConfig,
  params: {
    from: LatLng;
    to: LatLng;
    bikeType: BikeType;
    rideProfile?: RideProfile;
    avoidAsphalt?: boolean;
    skipGpx?: boolean;
  },
): Promise<BrouterRouteResult> {
  await ensureBrouterServer(config);
  return fetchBrouterRoute(
    config,
    params.bikeType,
    [params.from, params.to],
    "Loopforge dojazd",
    {
      skipGpx: params.skipGpx ?? true,
      rideProfile: params.rideProfile ?? "fast",
      avoidAsphalt: params.avoidAsphalt ?? false,
    },
  );
}

/** Route through explicit waypoints and return to start (closed loop). */
export async function fetchRouteThroughWaypoints(
  config: BrouterConfig,
  params: WaypointRouteParams,
): Promise<BrouterRouteResult> {
  await ensureBrouterServer(config);

  const loop = [params.start, ...params.waypoints, params.start];
  return fetchBrouterRoute(
    config,
    params.bikeType,
    loop,
    `Loopforge ${params.bikeType}`,
    {
      skipGpx: params.skipGpx,
      rideProfile: params.rideProfile,
      avoidAsphalt: params.avoidAsphalt,
      preferQuietRoutes: params.preferQuietRoutes,
      urbanRouting: params.urbanRouting,
      closedLoop: true,
    },
  );
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

  const response = await fetchBrouterWithRetry(
    config,
    `${config.baseUrl}/brouter?${query.toString()}`,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.trim() || `BRouter HTTP ${response.status}`);
  }

  const geojson = (await response.json()) as BrouterGeoJson;
  const feature = geojson.features[0];
  if (!feature?.geometry?.coordinates?.length) {
    throw new Error("BRouter returned an empty route");
  }

  const coordinates = filterCoordinates(feature.geometry.coordinates);
  if (coordinates.length < 2) {
    throw new Error("BRouter returned invalid route coordinates");
  }
  const messages = feature.properties.messages as string[][] | undefined;
  const segments = parseSegmentsFromMessages(messages);
  const mapGeojson = buildColoredGeoJsonFromRoute(coordinates, messages);
  const distanceKm = distanceFromCoordinates(coordinates) / 1000;
  const elevationGainM = Number(feature.properties["filtered ascend"] ?? 0);

  const gpxResponse = await fetch(
    `${config.baseUrl}/brouter?${new URLSearchParams({
      ...Object.fromEntries(query),
      format: "gpx",
      trackname: `Loopforge ${params.bikeType}`,
    }).toString()}`,
    { signal: AbortSignal.timeout(45_000) },
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

/** Legacy BRouter round-trip mode — can produce backtracking spurs. */
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
