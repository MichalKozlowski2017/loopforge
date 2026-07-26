import type {
  GenerateRouteRequest,
  GeneratedRoute,
  LatLng,
  OsmTags,
  RouteGenerationProgress,
  SurfaceCategory,
} from "@loopforge/osm-types";
import { getRideProfileLoopPrefs, getSurfaceStyle } from "@loopforge/osm-types";
import {
  fetchRouteThroughWaypoints as fetchBrouterRoute,
  fetchApproachRouteBetweenPoints as fetchBrouterApproach,
  fetchApproachRouteThroughPoints as fetchBrouterApproachThrough,
  getBrouterConfig,
  buildRouteMapGeoJson,
  pickDensestRouteCoordinates,
} from "@loopforge/brouter";
import {
  fetchRouteThroughWaypoints as fetchPgRoute,
  fetchApproachRouteBetweenPoints as fetchPgApproach,
  isRoutingReady,
  surfaceBreakdownFromSegments,
} from "@loopforge/routing";
import { buildGpx } from "@loopforge/gpx";
import { scoreRoute } from "@loopforge/scoring";
import { buildLoopWaypointsWithVia } from "./via-points";
import { validateViaPointsForRoute } from "./via-validation";
import {
  createGenerationJitter,
  isGoodLoopQuality,
  loopQualityMetrics,
  loopShapeForVariant,
  scoreLoopQualityWithShape,
  type LoopShape,
} from "./loop-waypoints";
import {
  prepareCoordinatesForNavigation,
  pruneDeadEndSpurs,
  pruneMapGeoJson,
  routeLengthM,
  hasBrokenRouteGeometry,
  hasHardTeleportEdge,
} from "./prune-spurs";
import { mirroredPrefixLengthM, maxMirroredPrefixBudgetM } from "./route-quality";
import {
  maxAcceptableDistanceError,
  maxLoopShareOfTarget,
  mergeLoopPrefs,
  minLoopShareOfTarget,
  shouldEscalateUrbanTuning,
  urbanWaypointAdjustments,
  useUrbanRouting,
} from "./urban-context";
import {
  approachOverlapShare,
  computeLoopEntryTarget,
  loopEntryOffsetM,
  mergeApproachAndLoop,
  MAX_APPROACH_OVERLAP_RELAXED,
  PREFER_APPROACH_OVERLAP_BELOW,
  pruneApproachLeg,
  type RoutedLeg,
} from "./approach";
import { refineApproachForLoopEntry } from "./approach-entry";
import { approachLooksLikeCemeteryDetour } from "./approach-sanitize";
import {
  buildApproachCorridorWaypoints,
} from "./loop-anchor";

const DIRECTION_BEARING: Record<
  import("@loopforge/osm-types").Direction,
  number
> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
};

const DIRECTION_LABEL_PL: Record<
  import("@loopforge/osm-types").Direction,
  string
> = {
  N: "północ",
  NE: "północny wschód",
  E: "wschód",
  SE: "południowy wschód",
  S: "południe",
  SW: "południowy zachód",
  W: "zachód",
  NW: "północny zachód",
};

export interface GenerateRouteOptions {
  onProgress?: (progress: RouteGenerationProgress) => void;
  /** When set, penalize loop legs that reuse the approach corridor. */
  approachCoordinates?: [number, number][];
  /** User's home start — biases loop waypoints away from the approach leg. */
  homeStart?: LatLng;
}

function reportProgress(
  onProgress: GenerateRouteOptions["onProgress"],
  progress: RouteGenerationProgress,
): void {
  onProgress?.(progress);
}

const EARTH_RADIUS_M = 6_371_000;

interface RoutedLoopResult {
  coordinates: [number, number][];
  distanceKm: number;
  elevationGainM: number;
  segments: { tags: import("@loopforge/osm-types").OsmTags; distanceM: number }[];
  mapGeojson?: import("@loopforge/osm-types").RouteMapGeoJson;
  gpx?: string;
  brouterMessages?: string[][];
}

function syncMapGeoJson(
  coordinates: [number, number][],
  routed: Pick<RoutedLoopResult, "mapGeojson" | "brouterMessages">,
): import("@loopforge/osm-types").RouteMapGeoJson | undefined {
  // Prefer coloring the exact displayed polyline (road-following GeoJSON).
  // Never rebuild from sparse message vertices alone — that draws air chords.
  // Never fall back to unpruned mapGeojson — that reintroduces dead-end stubs.
  if (coordinates.length >= 2) {
    const colored = buildRouteMapGeoJson(coordinates, routed.brouterMessages);
    if (colored) return colored;
  }
  return pruneMapGeoJson(routed.mapGeojson ?? null, coordinates) ?? undefined;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function destinationPoint(
  start: LatLng,
  bearingDeg: number,
  distanceM: number,
): LatLng {
  const bearing = toRadians(bearingDeg);
  const lat1 = toRadians(start.lat);
  const lng1 = toRadians(start.lng);
  const angular = distanceM / EARTH_RADIUS_M;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDegrees(lat2), lng: toDegrees(lng2) };
}

function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function lineCoordinates(
  from: LatLng,
  to: LatLng,
  steps = 8,
): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    coords.push([
      from.lng + (to.lng - from.lng) * t,
      from.lat + (to.lat - from.lat) * t,
    ]);
  }
  return coords;
}

function buildPlaceholderLoop(
  start: LatLng,
  direction: import("@loopforge/osm-types").Direction,
  distanceKm: number,
): [number, number][] {
  const bearing = DIRECTION_BEARING[direction];
  const legM = (distanceKm * 1000) / 4;
  const p1 = destinationPoint(start, bearing, legM);
  const p2 = destinationPoint(p1, bearing + 90, legM);
  const p3 = destinationPoint(p2, bearing + 180, legM);

  return [
    ...lineCoordinates(start, p1),
    ...lineCoordinates(p1, p2).slice(1),
    ...lineCoordinates(p2, p3).slice(1),
    ...lineCoordinates(p3, start).slice(1),
  ];
}

function totalDistanceKm(coords: [number, number][]): number {
  let meters = 0;
  for (let i = 1; i < coords.length; i++) {
    meters += haversineM(
      { lat: coords[i - 1][1], lng: coords[i - 1][0] },
      { lat: coords[i][1], lng: coords[i][0] },
    );
  }
  return meters / 1000;
}

function buildGeneratedRoute(
  request: GenerateRouteRequest,
  coordinates: [number, number][],
  options: {
    placeholder: boolean;
    elevationGainM: number;
    segments: { tags: import("@loopforge/osm-types").OsmTags; distanceM: number }[];
    mapGeojson?: import("@loopforge/osm-types").RouteMapGeoJson;
    brouterMessages?: string[][];
    gpx?: string;
  },
): GeneratedRoute {
  const { start, bikeType, direction, distanceKm } = request;
  const geoCtx = { start };
  const denseCoordinates = pickDensestRouteCoordinates(
    coordinates,
    options.brouterMessages,
  );
  // Keep map + GPX on the same road-following polyline. Safe spur prune only.
  const navCoordinates = prepareCoordinatesForNavigation(
    denseCoordinates,
    geoCtx,
  );
  const displayCoordinates =
    !hasBrokenRouteGeometry(navCoordinates, denseCoordinates, geoCtx) &&
    navCoordinates.length >= 2
      ? navCoordinates
      : denseCoordinates;
  // Only hard teleports fail the build — soft air-chord checks are for prune rollback.
  if (hasHardTeleportEdge(displayCoordinates)) {
    throw new Error(
      "Trasa ma przerwy w nawigacji (skróty przez mapę) — spróbuj innego kierunku lub krótszego dystansu.",
    );
  }
  const syncedMapGeojson = buildRouteMapGeoJson(
    displayCoordinates,
    options.brouterMessages,
  );
  const actualKm =
    displayCoordinates.length > 1
      ? totalDistanceKm(displayCoordinates)
      : distanceKm;
  const score = scoreRoute(options.segments, bikeType, request.profile);
  const id = crypto.randomUUID();
  const name = `Loopforge ${bikeType} ${Math.round(actualKm)}km`;
  const surfaceBreakdown =
    options.segments.length > 0
      ? surfaceBreakdownFromSegments(options.segments)
      : [
          { label: "Gravel", share: 0.55, color: "#f59e0b" },
          { label: "Utwardzony szuter", share: 0.3, color: "#eab308" },
          { label: "Asfalt", share: 0.15, color: "#94a3b8" },
        ];

  return {
    id,
    geojson: {
      type: "Feature",
      properties: {
        bikeType,
        direction,
        score,
        placeholder: options.placeholder,
      },
      geometry: {
        type: "LineString",
        coordinates: displayCoordinates,
      },
    },
    mapGeojson: syncedMapGeojson ?? undefined,
    metrics: {
      distanceKm: actualKm,
      loopDistanceKm: actualKm,
      elevationGainM: options.elevationGainM,
      surfaceBreakdown,
      score,
    },
    gpx: options.gpx ?? buildGpx(name, displayCoordinates, start),
    createdAt: new Date().toISOString(),
    segments: options.segments.length > 0 ? options.segments : undefined,
    // On-network reference = BRouter dense path before navigation prune.
    networkCoordinates: denseCoordinates,
  };
}

const MIN_PRUNE_REMOVED_M = 5;
const MAX_SPUR_SHARE = 0.035;
const MAX_BACKTRACK = 0.04;
/**
 * Relaxed ceilings must match prod matrix audit limits so we never ship a
 * loop that later fails SPUR/BACKTRACK/MIRRORED in test:prod.
 * Audit (non-approach): urban 0.14 / 0.20 / 800m; rural 0.08 / 0.09 / 800m.
 */
const MAX_SPUR_SHARE_RELAXED_URBAN = 0.14;
const MAX_BACKTRACK_RELAXED_URBAN = 0.2;
const MAX_SPUR_SHARE_RELAXED = 0.08;
const MAX_BACKTRACK_RELAXED = 0.09;
/**
 * Approach loops start mid-corridor; dense grids often produce higher spur than
 * home-based loops. Merged-route audits already ignore spur on dojazd+loop+powrót.
 */
const MAX_SPUR_SHARE_RELAXED_APPROACH_URBAN = 0.65;
const MAX_BACKTRACK_RELAXED_APPROACH_URBAN = 0.45;
const MAX_SPUR_SHARE_RELAXED_APPROACH = 0.8;
const MAX_BACKTRACK_RELAXED_APPROACH = 0.45;
/**
 * Last-resort distance share. Keep below the old 2.1–2.6× disasters, but
 * 1.35× was too tight and spiked gen-fails in stress.
 */
const MAX_LOOP_SHARE_EMERGENCY = 1.55;
/** Road+quiet needs a bit more room before hard GEN_FAIL. */
const MAX_LOOP_SHARE_EMERGENCY_ROAD = 1.75;
/**
 * Never ship a loop far below the request (stress had 60→34 km PASS).
 * Emergency floor is slightly softer but still blocks half-length disasters.
 */
const MIN_LOOP_SHARE_SHIP = 0.75;
const MIN_LOOP_SHARE_EMERGENCY = 0.68;
/** Approach loops may overshoot more — entry is mid-corridor, not home. */
const MAX_LOOP_SHARE_APPROACH_URBAN = 1.7;
const MAX_LOOP_SHARE_APPROACH = 1.55;
const MAX_DISTANCE_ERROR_APPROACH_RELAXED = 0.55;
const MAX_BACKTRACK_URBAN = 0.08;
/**
 * Wall-clock budgets — hard stop even without a strict `best`.
 * Client timeout is 3 min; we must ship or fail well before that.
 */
const GENERATION_DEADLINE_URBAN_MS = 55_000;
const GENERATION_DEADLINE_RURAL_MS = 45_000;
/** Road+quiet burns more attempts — give a bit more clock than gravel/MTB. */
const GENERATION_DEADLINE_ROAD_MS = 65_000;
const MAX_SCALE_PASSES = 5;
/** Cap successful BRouter loop fetches so search cannot burn minutes. */
const MAX_ROUTED_FETCHES_URBAN = 10;
const MAX_ROUTED_FETCHES = 12;
/** Keep headroom for recovery stretch after the main search empties. */
const RECOVERY_FETCH_RESERVE = 3;
const SCALE_TARGET_DISTANCE_ERROR = 0.12;

function approachMaxLoopShare(urban: boolean): number {
  return urban ? MAX_LOOP_SHARE_APPROACH_URBAN : MAX_LOOP_SHARE_APPROACH;
}

/** Mirror length after nav densify — matches GPX audit (sparse coords under-count). */
function densifiedMirrorLengthM(
  coordinates: [number, number][],
  start: LatLng,
): number {
  if (coordinates.length < 4) return 0;
  const nav = prepareCoordinatesForNavigation(coordinates, { start });
  return mirroredPrefixLengthM(nav.length >= 4 ? nav : coordinates);
}

function exceedsMirrorBudget(
  coordinates: [number, number][],
  targetDistanceKm: number,
  start: LatLng,
  approachMode: boolean,
): boolean {
  if (approachMode) return false;
  return (
    densifiedMirrorLengthM(coordinates, start) >
    maxMirroredPrefixBudgetM(targetDistanceKm)
  );
}

function passesDeliverableGeometry(
  coordinates: [number, number][],
  options: {
    targetDistanceKm: number;
    actualDistanceKm: number;
    start: LatLng;
    direction: GenerateRouteRequest["direction"];
    approachMode: boolean;
    urban: boolean;
    relaxed: boolean;
    preferQuiet?: boolean;
    /**
     * Wider distance share only — spur/back/mirror still use relaxed audit caps.
     * Kept so callers can opt into emergency distance without shipping trash geometry.
     */
    emergency?: boolean;
  },
): boolean {
  if (coordinates.length < 4) return false;
  if (hasHardTeleportEdge(coordinates)) return false;

  const metrics = loopQualityMetrics(
    coordinates,
    options.targetDistanceKm,
    options.actualDistanceKm,
    options.start,
    options.direction,
  );

  // Geometry ceilings always match audit. Quiet no longer gets a softer
  // spur/back budget. Emergency only widens distance share at the call site.
  const approachRelaxed = Boolean(options.approachMode && options.relaxed);
  const maxSpur = options.relaxed
    ? approachRelaxed
      ? options.urban
        ? MAX_SPUR_SHARE_RELAXED_APPROACH_URBAN
        : MAX_SPUR_SHARE_RELAXED_APPROACH
      : options.urban
        ? MAX_SPUR_SHARE_RELAXED_URBAN
        : MAX_SPUR_SHARE_RELAXED
    : MAX_SPUR_SHARE;
  const maxBacktrack = options.relaxed
    ? approachRelaxed
      ? options.urban
        ? MAX_BACKTRACK_RELAXED_APPROACH_URBAN
        : MAX_BACKTRACK_RELAXED_APPROACH
      : options.urban
        ? MAX_BACKTRACK_RELAXED_URBAN
        : MAX_BACKTRACK_RELAXED
    : options.urban
      ? MAX_BACKTRACK_URBAN
      : MAX_BACKTRACK;

  if (metrics.spurShare > maxSpur) return false;
  if (metrics.backtrack > maxBacktrack) return false;

  if (
    exceedsMirrorBudget(
      coordinates,
      options.targetDistanceKm,
      options.start,
      options.approachMode,
    )
  ) {
    return false;
  }

  return true;
}

function emergencyMaxLoopShare(bikeType: GenerateRouteRequest["bikeType"]): number {
  return bikeType === "road"
    ? MAX_LOOP_SHARE_EMERGENCY_ROAD
    : MAX_LOOP_SHARE_EMERGENCY;
}

function geometryPenalty(
  coordinates: [number, number][],
  targetDistanceKm: number,
  actualDistanceKm: number,
  start: LatLng,
  direction: GenerateRouteRequest["direction"],
  approachMode: boolean,
): number {
  const metrics = loopQualityMetrics(
    coordinates,
    targetDistanceKm,
    actualDistanceKm,
    start,
    direction,
  );
  const mirrorKm = approachMode
    ? 0
    : mirroredPrefixLengthM(coordinates) / 1000;
  return (
    metrics.distanceError * 0.55 +
    metrics.spurShare * 48 +
    metrics.backtrack * 30 +
    (1 - metrics.directionCoverage) * 1.4 +
    mirrorKm * 0.35
  );
}

function pavedShareFromSegments(
  segments: { tags: OsmTags; distanceM: number }[],
): number {
  let pavedM = 0;
  let totalM = 0;
  for (const segment of segments) {
    if (segment.distanceM <= 0) continue;
    totalM += segment.distanceM;
    if (getSurfaceStyle(segment.tags).category === "asphalt") {
      pavedM += segment.distanceM;
    }
  }
  return totalM > 0 ? pavedM / totalM : 0;
}

/** Carriageways tagged bicycle=use_sidepath / no — riders should use the sidepath. */
function badBikeAccessMeters(
  segments: { tags: OsmTags; distanceM: number }[],
): { useSidepathM: number; forbiddenM: number } {
  let useSidepathM = 0;
  let forbiddenM = 0;
  for (const segment of segments) {
    if (segment.distanceM <= 0) continue;
    const bicycle = segment.tags.bicycle?.toLowerCase();
    if (bicycle === "use_sidepath") useSidepathM += segment.distanceM;
    if (bicycle === "no" || bicycle === "dismount") forbiddenM += segment.distanceM;
  }
  return { useSidepathM, forbiddenM };
}

const MAX_USE_SIDEPATH_M = 25;
/** Match route-quality audit — never ship more than this of bicycle=no|dismount. */
const MAX_BICYCLE_FORBIDDEN_M = 25;

function hasHardSidepathAccess(
  segments: { tags: OsmTags; distanceM: number }[],
): boolean {
  return badBikeAccessMeters(segments).useSidepathM > MAX_USE_SIDEPATH_M;
}

function hasForbiddenBikeAccess(
  segments: { tags: OsmTags; distanceM: number }[],
): boolean {
  return badBikeAccessMeters(segments).forbiddenM > MAX_BICYCLE_FORBIDDEN_M;
}

function hasBadBikeAccess(
  segments: { tags: OsmTags; distanceM: number }[],
): boolean {
  return hasHardSidepathAccess(segments) || hasForbiddenBikeAccess(segments);
}

const OFFROAD_CATEGORIES = new Set<SurfaceCategory>([
  "gravel",
  "compacted",
  "dirt",
  "path",
  "forest",
]);

function offroadShareFromSegments(
  segments: { tags: OsmTags; distanceM: number }[],
): number {
  let offroadM = 0;
  let totalM = 0;
  for (const segment of segments) {
    if (segment.distanceM <= 0) continue;
    totalM += segment.distanceM;
    if (OFFROAD_CATEGORIES.has(getSurfaceStyle(segment.tags).category)) {
      offroadM += segment.distanceM;
    }
  }
  return totalM > 0 ? offroadM / totalM : 0;
}

const BUSY_HIGHWAYS = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
]);

function busyRoadShareFromSegments(
  segments: { tags: OsmTags; distanceM: number }[],
): number {
  let busyM = 0;
  let totalM = 0;
  for (const segment of segments) {
    if (segment.distanceM <= 0) continue;
    totalM += segment.distanceM;
    const highway = segment.tags.highway;
    if (highway && BUSY_HIGHWAYS.has(highway)) {
      busyM += segment.distanceM;
    }
  }
  return totalM > 0 ? busyM / totalM : 0;
}

function isBrouterIslandError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /target island|island detected|not reachable|cannot find a route|routing failed|endpoint not found/i.test(
    msg,
  );
}

function shrinkWaypointsTowardStart(
  start: LatLng,
  waypoints: LatLng[],
  factor: number,
): LatLng[] {
  return waypoints.map((wp) => ({
    lat: start.lat + (wp.lat - start.lat) * factor,
    lng: start.lng + (wp.lng - start.lng) * factor,
  }));
}

function thinWaypoints(waypoints: LatLng[], step: number): LatLng[] {
  if (waypoints.length <= 3 || step <= 1) return waypoints;
  const thinned: LatLng[] = [];
  for (let i = 0; i < waypoints.length; i++) {
    if (i === waypoints.length - 1 || i % step === 0) {
      thinned.push(waypoints[i]!);
    }
  }
  return thinned.length >= 2 ? thinned : waypoints;
}

async function fetchLoopRouteResilient(
  fetchRoute: (params: {
    start: LatLng;
    bikeType: GenerateRouteRequest["bikeType"];
    waypoints: LatLng[];
    rideProfile?: GenerateRouteRequest["profile"];
    avoidAsphalt?: boolean;
    preferQuietRoutes?: boolean;
    urbanRouting?: boolean;
    skipGpx: boolean;
  }) => Promise<RoutedLoopResult>,
  params: {
    start: LatLng;
    bikeType: GenerateRouteRequest["bikeType"];
    waypoints: LatLng[];
    rideProfile?: GenerateRouteRequest["profile"];
    avoidAsphalt?: boolean;
    preferQuietRoutes?: boolean;
    urbanRouting?: boolean;
    skipGpx: boolean;
  },
): Promise<RoutedLoopResult> {
  const attempts = [
    params.waypoints,
    shrinkWaypointsTowardStart(params.start, params.waypoints, 0.88),
    thinWaypoints(
      shrinkWaypointsTowardStart(params.start, params.waypoints, 0.82),
      2,
    ),
  ];

  let lastError: unknown;
  for (const waypoints of attempts) {
    try {
      return await fetchRoute({ ...params, waypoints });
    } catch (error) {
      lastError = error;
      if (!isBrouterIslandError(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function applySpurRefinement(
  routed: RoutedLoopResult,
  targetDistanceKm: number,
  start: LatLng,
  direction: GenerateRouteRequest["direction"],
  shape: LoopShape,
  avoidAsphalt = false,
  approachCoordinates?: [number, number][],
  viaPointsMode = false,
  profilePrefs?: ReturnType<typeof getRideProfileLoopPrefs>,
  preferQuietRoutes = false,
): {
  refined: RoutedLoopResult;
  metrics: ReturnType<typeof loopQualityMetrics> & { approachOverlap: number };
  quality: number;
  pruned: boolean;
} {
  const geoCtx = { start };
  const pruned = pruneDeadEndSpurs(routed.coordinates, geoCtx);
  let usePruned =
    pruned.removedRanges.length > 0 &&
    pruned.removedM >= MIN_PRUNE_REMOVED_M &&
    pruned.coordinates.length >= 4 &&
    !hasHardTeleportEdge(pruned.coordinates);
  let coordinates = usePruned ? pruned.coordinates : routed.coordinates;

  if (usePruned) {
    const beforeM = loopQualityMetrics(
      routed.coordinates,
      targetDistanceKm,
      routed.distanceKm,
      start,
      direction,
    );
    const afterKm = routeLengthM(pruned.coordinates) / 1000;
    const afterM = loopQualityMetrics(
      pruned.coordinates,
      targetDistanceKm,
      afterKm,
      start,
      direction,
    );
    const qualityImproved =
      afterM.spurShare + afterM.backtrack <
      beforeM.spurShare + beforeM.backtrack - 0.004;
    // Prefer shorter clean loop over fingers — keep cuts from ~80 m up.
    const meaningfulCut = pruned.removedM >= 80;
    const hardBroken = hasHardTeleportEdge(pruned.coordinates);
    const softBroken = hasBrokenRouteGeometry(
      coordinates,
      routed.coordinates,
      geoCtx,
    );
    if (hardBroken) {
      usePruned = false;
      coordinates = routed.coordinates;
    } else if (softBroken && !meaningfulCut && !qualityImproved) {
      usePruned = false;
      coordinates = routed.coordinates;
    } else if (!qualityImproved && !meaningfulCut) {
      usePruned = false;
      coordinates = routed.coordinates;
    }
  }

  const mapGeojson = syncMapGeoJson(coordinates, routed);

  const refined: RoutedLoopResult = {
    ...routed,
    coordinates,
    mapGeojson: mapGeojson ?? undefined,
    distanceKm: routeLengthM(coordinates) / 1000,
  };

  const approachOverlap = approachCoordinates
    ? approachOverlapShare(coordinates, approachCoordinates)
    : 0;

  const metrics = {
    ...loopQualityMetrics(
      coordinates,
      targetDistanceKm,
      refined.distanceKm,
      start,
      direction,
    ),
    approachOverlap,
  };
  const quality = scoreLoopQualityWithShape(
    coordinates,
    targetDistanceKm,
    refined.distanceKm,
    shape,
    start,
    direction,
    {
      avoidAsphalt,
      preferQuietRoutes,
      pavedShare: pavedShareFromSegments(routed.segments),
      busyRoadShare: busyRoadShareFromSegments(routed.segments),
      offroadShare: offroadShareFromSegments(routed.segments),
      approachOverlap,
      viaPointsMode,
      profilePrefs,
    },
  );

  return { refined, metrics, quality, pruned: usePruned };
}

function finalizeLoopWithoutSpurs(
  best: RoutedLoopResult,
  start: LatLng,
  targetDistanceKm: number,
  direction: GenerateRouteRequest["direction"],
): RoutedLoopResult {
  const geoCtx = { start };
  const pruned = pruneDeadEndSpurs(best.coordinates, geoCtx);
  if (
    pruned.removedRanges.length === 0 ||
    pruned.removedM < MIN_PRUNE_REMOVED_M ||
    pruned.coordinates.length < 4 ||
    hasHardTeleportEdge(pruned.coordinates)
  ) {
    return best;
  }

  const before = loopQualityMetrics(
    best.coordinates,
    targetDistanceKm,
    best.distanceKm,
    start,
    direction,
  );
  const afterKm = routeLengthM(pruned.coordinates) / 1000;
  const after = loopQualityMetrics(
    pruned.coordinates,
    targetDistanceKm,
    afterKm,
    start,
    direction,
  );
  const qualityImproved =
    after.spurShare + after.backtrack <
    before.spurShare + before.backtrack - 0.004;
  const meaningfulCut = pruned.removedM >= 80;
  const softBroken = hasBrokenRouteGeometry(
    pruned.coordinates,
    best.coordinates,
    geoCtx,
  );

  // Always prefer cutting mid-loop fingers over keeping padded distance.
  if (softBroken && !meaningfulCut && !qualityImproved) {
    return best;
  }
  if (!qualityImproved && !meaningfulCut) {
    return best;
  }

  const coordinates = pruned.coordinates;
  const mapGeojson = syncMapGeoJson(coordinates, best);

  return {
    ...best,
    coordinates,
    mapGeojson,
    distanceKm: afterKm,
  };
}

async function generateRouteWithEngine(
  request: GenerateRouteRequest,
  fetchRoute: (params: {
    start: LatLng;
    bikeType: GenerateRouteRequest["bikeType"];
    waypoints: LatLng[];
    rideProfile?: GenerateRouteRequest["profile"];
    avoidAsphalt?: boolean;
    preferQuietRoutes?: boolean;
    urbanRouting?: boolean;
    skipGpx: boolean;
  }) => Promise<RoutedLoopResult>,
  options?: GenerateRouteOptions,
): Promise<{
  route: GeneratedRoute;
  loopSegments: { tags: OsmTags; distanceM: number }[];
}> {
  const variants = 5;
  const jitter = createGenerationJitter(variants);
  const profilePrefs = getRideProfileLoopPrefs(
    request.bikeType,
    request.profile,
  );
  const baseUrban = useUrbanRouting(request.start, request.distanceKm);
  const geoCtx = { start: request.start };
  const deadlineMs =
    Date.now() +
    (request.bikeType === "road"
      ? GENERATION_DEADLINE_ROAD_MS
      : baseUrban
        ? GENERATION_DEADLINE_URBAN_MS
        : GENERATION_DEADLINE_RURAL_MS);
  let best: RoutedLoopResult | null = null;
  let bestScore = Infinity;
  let bestRejected: RoutedLoopResult | null = null;
  let bestRejectedScore = Infinity;
  let bestFallback: RoutedLoopResult | null = null;
  let bestFallbackScore = Infinity;
  let bestLowOverlap: RoutedLoopResult | null = null;
  let bestLowOverlapShare = Infinity;
  let bestApproachOverlap = Infinity;
  let usedRelaxedFallback = false;
  let attempt = 0;
  let routedFetches = 0;
  const maxRoutedFetches = baseUrban
    ? MAX_ROUTED_FETCHES_URBAN
    : MAX_ROUTED_FETCHES;
  const mainSearchFetchCap = Math.max(
    4,
    maxRoutedFetches - RECOVERY_FETCH_RESERVE,
  );
  // Metro used to cap at 3 scale passes — undershoot then hit the 75% ship floor.
  const maxScalePasses =
    baseUrban || request.avoidAsphalt || request.preferQuietRoutes
      ? Math.max(4, MAX_SCALE_PASSES - 1)
      : MAX_SCALE_PASSES;
  const maxAttemptsEstimate = variants * maxScalePasses;
  const minLoopKm =
    request.distanceKm * minLoopShareOfTarget(request.distanceKm, baseUrban);
  const { onProgress } = options ?? {};

  const tryPromoteRelaxedPool = (): boolean => {
    if (best) return true;
    const maxShare = options?.approachCoordinates
      ? approachMaxLoopShare(baseUrban)
      : maxLoopShareOfTarget(request.distanceKm, true, baseUrban);
    const minShare = MIN_LOOP_SHARE_EMERGENCY;
    const pool = [bestRejected, bestFallback, bestLowOverlap].filter(
      (c): c is RoutedLoopResult =>
        !!c &&
        c.coordinates.length >= 4 &&
        c.distanceKm >= request.distanceKm * minShare &&
        c.distanceKm <= request.distanceKm * maxShare &&
        !hasHardTeleportEdge(c.coordinates) &&
        !hasHardSidepathAccess(c.segments) &&
        !hasForbiddenBikeAccess(c.segments) &&
        (options?.approachCoordinates != null ||
          !exceedsMirrorBudget(
            c.coordinates,
            request.distanceKm,
            request.start,
            false,
          )) &&
        passesDeliverableGeometry(c.coordinates, {
          targetDistanceKm: request.distanceKm,
          actualDistanceKm: c.distanceKm,
          start: request.start,
          direction: request.direction,
          approachMode: options?.approachCoordinates != null,
          urban: baseUrban,
          relaxed: true,
          preferQuiet: Boolean(request.preferQuietRoutes),
        }),
    );
    if (pool.length === 0) return false;
    pool.sort(
      (a, b) =>
        geometryPenalty(
          a.coordinates,
          request.distanceKm,
          a.distanceKm,
          request.start,
          request.direction,
          options?.approachCoordinates != null,
        ) -
        geometryPenalty(
          b.coordinates,
          request.distanceKm,
          b.distanceKm,
          request.start,
          request.direction,
          options?.approachCoordinates != null,
        ),
    );
    best = pool[0]!;
    usedRelaxedFallback = true;
    return true;
  };

  reportProgress(onProgress, {
    phase: "planning",
    message: "Szkicuję obwód pętli",
    detail: baseUrban
      ? `${request.distanceKm} km — tryb miejski (gęsta siatka dróg)`
      : `${request.distanceKm} km w kierunku ${DIRECTION_LABEL_PL[request.direction]}`,
    progress: 6,
  });

  reportProgress(onProgress, {
    phase: "variants",
    message: "Kuję warianty",
    detail: "Każdy obwód wychodzi inny",
    progress: 12,
  });

  for (const variant of jitter.variantOrder) {
    // Hard wall-clock stop — promote the best deliverable pool immediately.
    if (Date.now() > deadlineMs) {
      tryPromoteRelaxedPool();
      break;
    }
    if (routedFetches >= mainSearchFetchCap) {
      tryPromoteRelaxedPool();
      break;
    }
    // Soft stop: once we have a deliverable fallback and clock is tight, ship it.
    if (
      !best &&
      (bestFallback || bestRejected) &&
      Date.now() > deadlineMs - 20_000 &&
      tryPromoteRelaxedPool()
    ) {
      break;
    }

    try {
        // Prefer starting a bit compact in metro so short targets don't explode.
        const scales: number[] = [
          baseUrban && request.distanceKm <= 25 ? 0.88 : 1.0,
        ];
      let variantDone = false;
      let variantUrbanEscalated = baseUrban;

      for (let si = 0; si < scales.length; si++) {
        if (Date.now() > deadlineMs) {
          tryPromoteRelaxedPool();
          variantDone = true;
          break;
        }
        if (routedFetches >= mainSearchFetchCap) {
          tryPromoteRelaxedPool();
          variantDone = true;
          break;
        }

        const scale = scales[si]!;
        const loopPrefs = mergeLoopPrefs(
          profilePrefs,
          urbanWaypointAdjustments(
            request.distanceKm,
            variantUrbanEscalated,
            baseUrban,
          ),
        );
        const shape = loopShapeForVariant(
          request.distanceKm,
          variant,
          loopPrefs,
        );
        const shapeLabel = shape === "arc" ? "łuk" : "podłużna";
        attempt += 1;
        const routingProgress = Math.min(
          85,
          14 + (attempt / maxAttemptsEstimate) * 68,
        );

        reportProgress(onProgress, {
          phase: "routing",
          message: "Wykuwam nitkę trasy",
          detail: `Obwód ${variant + 1}/${variants}, kształt ${shapeLabel}${
            si > 0 ? ", ponowne wykuwanie" : ""
          }`,
          progress: routingProgress,
          variantIndex: variant + 1,
          variantTotal: variants,
        });

        const viaCoords =
          request.viaPoints?.map((p) => ({ lat: p.lat, lng: p.lng })) ?? [];
        // Drop quiet/avoid early. Road+quiet/avoid: never force prefs during
        // search (one hard try burns the Kraków GEN_FAIL bucket). Other bikes:
        // keep prefs only on the first scale of the first variant.
        const hardPrefs =
          Boolean(request.preferQuietRoutes) || Boolean(request.avoidAsphalt);
        const firstVariant = jitter.variantOrder[0] ?? 0;
        const softenAccess = hardPrefs
          ? request.bikeType === "road"
            ? true
            : variant !== firstVariant ||
              si > 0 ||
              Date.now() > deadlineMs - 40_000
          : variant >= 1 || Date.now() > deadlineMs - 28_000;
        const routeAvoidAsphalt = softenAccess
          ? false
          : Boolean(request.avoidAsphalt);
        const routePreferQuiet = softenAccess
          ? false
          : Boolean(request.preferQuietRoutes);
        // homeStart shift often forces mirrored out-and-backs — drop early.
        const useHomeStart = Boolean(options?.homeStart) && variant < 2;
        const waypoints = buildLoopWaypointsWithVia(
          request.start,
          request.distanceKm,
          request.direction,
          variant,
          scale,
          shape,
          routeAvoidAsphalt,
          jitter,
          viaCoords,
          useHomeStart && options?.homeStart
            ? { homeStart: options.homeStart }
            : undefined,
          loopPrefs,
        );
        routedFetches += 1;
        const routed = await fetchLoopRouteResilient(fetchRoute, {
          start: request.start,
          bikeType: request.bikeType,
          waypoints,
          rideProfile: request.profile,
          avoidAsphalt: routeAvoidAsphalt,
          preferQuietRoutes: routePreferQuiet,
          urbanRouting: baseUrban || variantUrbanEscalated,
          skipGpx: true,
        });

        if (hasHardTeleportEdge(routed.coordinates)) continue;

        const hasFerry = routed.segments.some(
          (segment) => segment.tags.route === "ferry",
        );
        if (hasFerry) continue;

        const { refined, metrics, quality } = applySpurRefinement(
          routed,
          request.distanceKm,
          request.start,
          request.direction,
          shape,
          routeAvoidAsphalt,
          options?.approachCoordinates,
          (request.viaPoints?.length ?? 0) > 0,
          loopPrefs,
          routePreferQuiet,
        );

        if (
          baseUrban &&
          shouldEscalateUrbanTuning(request.distanceKm, refined.distanceKm)
        ) {
          variantUrbanEscalated = true;
        }

        reportProgress(onProgress, {
          phase: "scoring",
          message: "Testuję obwód",
          detail: `${refined.distanceKm.toFixed(1)} km — nawierzchnia, kierunek, jakość pętli`,
          progress: Math.min(88, routingProgress + 3),
          variantIndex: variant + 1,
          variantTotal: variants,
        });

        if (hasHardSidepathAccess(refined.segments)) {
          // Never keep carriageways tagged use_sidepath as candidates.
          if (process.env.LOOPFORGE_DEBUG_ACCESS === "1") {
            const bad = badBikeAccessMeters(refined.segments);
            console.warn(
              `[loopforge] skip use_sidepath: ${Math.round(bad.useSidepathM)}m dist=${refined.distanceKm.toFixed(1)}km`,
            );
          }
          continue;
        }

        if (hasForbiddenBikeAccess(refined.segments)) {
          // Never ship bicycle=no|dismount — audit fails at >25 m.
          if (process.env.LOOPFORGE_DEBUG_ACCESS === "1") {
            const bad = badBikeAccessMeters(refined.segments);
            console.warn(
              `[loopforge] skip forbidden access: ${Math.round(bad.forbiddenM)}m dist=${refined.distanceKm.toFixed(1)}km`,
            );
          }
          continue;
        }

        if (quality < bestFallbackScore) {
          bestFallbackScore = quality;
          bestFallback = refined;
        }

        // Extend scale when loop is too short (common in dense urban grids).
        // Skip once we already have a shippable best — extra BRouter burns time.
        // Use *route* avoid flag (after soften), not the raw user toggle — otherwise
        // softened routing still stretches with the weak avoid=0.48 pull.
        if (
          !best &&
          refined.distanceKm < request.distanceKm * 0.98 &&
          metrics.distanceError > SCALE_TARGET_DISTANCE_ERROR &&
          scales.length < maxScalePasses &&
          Date.now() < deadlineMs - 5_000 &&
          routedFetches < mainSearchFetchCap
        ) {
          const ratio = request.distanceKm / Math.max(refined.distanceKm, 1);
          const hasVias = (request.viaPoints?.length ?? 0) > 0;
          const stretch =
            ratio > 1
              ? 1 +
                (ratio - 1) *
                  (hasVias ? 0.92 : routeAvoidAsphalt ? 0.72 : 0.98)
              : 0.98;
          const maxScale = baseUrban || variantUrbanEscalated
            ? Math.min(1.95, 1.22 + request.distanceKm / 220)
            : hasVias
              ? Math.min(1.55, 1.14 + request.distanceKm / 320)
              : routeAvoidAsphalt
                ? Math.min(1.55, 1.12 + request.distanceKm / 320)
                : 1.7;
          const nextScale = Math.min(
            maxScale,
            Math.max(scale + 0.08, scale * stretch),
          );
          if (nextScale > scale + 0.03) {
            reportProgress(onProgress, {
              phase: "refining",
              message: "Docinam kilometry",
              detail: `Cel ~${request.distanceKm} km, teraz ${refined.distanceKm.toFixed(1)} km — poszerzam obwód`,
              progress: Math.min(90, routingProgress + 5),
            });
            scales.push(nextScale);
          }
        }

        // Shrink waypoints when loop is much longer than the target.
        if (
          !best &&
          refined.distanceKm > request.distanceKm * 1.08 &&
          metrics.distanceError > SCALE_TARGET_DISTANCE_ERROR &&
          scales.length < maxScalePasses &&
          Date.now() < deadlineMs - 5_000 &&
          routedFetches < mainSearchFetchCap
        ) {
          const ratio = request.distanceKm / Math.max(refined.distanceKm, 1);
          const severeOvershoot = refined.distanceKm > request.distanceKm * 1.4;
          const metroish = baseUrban || variantUrbanEscalated;
          const shrinkPull = severeOvershoot
            ? 1
            : metroish
              ? 0.92
              : request.bikeType === "road"
                ? 0.85
                : 0.75;
          const minDrop = severeOvershoot
            ? 0.12
            : metroish
              ? 0.08
              : 0.06;
          const floor = severeOvershoot
            ? 0.45
            : metroish
              ? 0.58
              : 0.7;
          const shrink = 1 - (1 - ratio) * shrinkPull;
          const nextScale = Math.max(
            floor,
            Math.min(scale - minDrop, scale * shrink),
          );
          if (nextScale < scale - 0.03) {
            reportProgress(onProgress, {
              phase: "refining",
              message: "Docinam kilometry",
              detail: `Cel ~${request.distanceKm} km, teraz ${refined.distanceKm.toFixed(1)} km — zwężam obwód`,
              progress: Math.min(90, routingProgress + 5),
            });
            scales.push(nextScale);
          }
        }

        const maxDistanceError = maxAcceptableDistanceError(
          request.distanceKm,
          false,
          baseUrban,
        );
        const maxLoopKm =
          request.distanceKm *
          maxLoopShareOfTarget(request.distanceKm, false, baseUrban);
        const tooShort =
          refined.distanceKm < minLoopKm ||
          metrics.distanceError > maxDistanceError;
        const tooLong = refined.distanceKm > maxLoopKm;

        const approachMode = options?.approachCoordinates != null;
        // Metro: primary accept uses audit-aligned spur/backtrack so dense
        // grids ship instead of burning minutes chasing 3.5% spur.
        const maxSpurStrict = approachMode
          ? (baseUrban
              ? MAX_SPUR_SHARE_RELAXED_APPROACH_URBAN
              : MAX_SPUR_SHARE_RELAXED_APPROACH) * 0.75
          : baseUrban
            ? MAX_SPUR_SHARE_RELAXED_URBAN
            : MAX_SPUR_SHARE;
        const maxBacktrackStrict = approachMode
          ? (baseUrban
              ? MAX_BACKTRACK_RELAXED_APPROACH_URBAN
              : MAX_BACKTRACK_RELAXED_APPROACH) * 0.75
          : baseUrban
            ? MAX_BACKTRACK_RELAXED_URBAN
            : MAX_BACKTRACK;
        const tooSpurHeavy =
          metrics.spurShare > maxSpurStrict ||
          metrics.backtrack > maxBacktrackStrict ||
          exceedsMirrorBudget(
            refined.coordinates,
            request.distanceKm,
            request.start,
            approachMode,
          );
        const wrongDirection = metrics.directionCoverage < 0.38;

        if (
          options?.approachCoordinates &&
          !tooSpurHeavy &&
          !wrongDirection &&
          metrics.approachOverlap < bestLowOverlapShare
        ) {
          bestLowOverlapShare = metrics.approachOverlap;
          bestLowOverlap = refined;
        }

        const tooShortWithVias =
          (request.viaPoints?.length ?? 0) > 0 &&
          metrics.distanceError > 0.22;

        if (
          tooSpurHeavy ||
          wrongDirection ||
          tooShortWithVias ||
          tooShort ||
          tooLong
        ) {
          if (quality < bestRejectedScore) {
            bestRejectedScore = quality;
            bestRejected = refined;
          }
          // Near deadline: accept a deliverable reject without more variants.
          if (
            Date.now() > deadlineMs - 15_000 &&
            tryPromoteRelaxedPool()
          ) {
            variantDone = true;
            break;
          }
          continue;
        }

        if (quality < bestScore) {
          let skipShortDetour = false;
          if (request.avoidAsphalt && best !== null) {
            const bestDistErr = loopQualityMetrics(
              best.coordinates,
              request.distanceKm,
              best.distanceKm,
              request.start,
              request.direction,
            ).distanceError;
            skipShortDetour =
              refined.distanceKm < best.distanceKm * 0.88 &&
              metrics.distanceError > bestDistErr + 0.06;
          }

          if (!skipShortDetour) {
            bestScore = quality;
            best = refined;
            bestApproachOverlap = metrics.approachOverlap;
          } else if (
            options?.approachCoordinates != null &&
            quality <= bestScore + 1.2 &&
            metrics.approachOverlap + 0.05 < bestApproachOverlap
          ) {
            bestScore = quality;
            best = refined;
            bestApproachOverlap = metrics.approachOverlap;
          }
        }

        if (
          isGoodLoopQuality(
            refined.coordinates,
            request.distanceKm,
            refined.distanceKm,
            request.start,
            request.direction,
          ) &&
          metrics.distanceError <= maxAcceptableDistanceError(
            request.distanceKm,
            false,
            baseUrban,
          ) &&
          refined.distanceKm >= minLoopKm
        ) {
          variantDone = true;
          break;
        }

        // Good-enough early exit — metro audit spur is enough to stop searching.
        if (
          metrics.directionCoverage >= 0.45 &&
          metrics.distanceError <
            maxAcceptableDistanceError(request.distanceKm, false, baseUrban) &&
          metrics.spurShare <
            (baseUrban ? MAX_SPUR_SHARE_RELAXED_URBAN : 0.06) &&
          metrics.backtrack <
            (baseUrban ? MAX_BACKTRACK_RELAXED_URBAN : 0.08) &&
          refined.distanceKm >= minLoopKm
        ) {
          variantDone = true;
          break;
        }

        // Already have a shippable best — don't burn more scale passes.
        if (best && (si > 0 || Date.now() > deadlineMs - 25_000)) {
          variantDone = true;
          break;
        }
      }

      if (variantDone) break;

      if (
        best &&
        isGoodLoopQuality(
          best.coordinates,
          request.distanceKm,
          best.distanceKm,
          request.start,
          request.direction,
        ) &&
        best.distanceKm >= minLoopKm &&
        loopQualityMetrics(
          best.coordinates,
          request.distanceKm,
          best.distanceKm,
          request.start,
          request.direction,
        ).distanceError <=
          maxAcceptableDistanceError(request.distanceKm, false, baseUrban)
      ) {
        break;
      }

      // After first deliverable metro loop, stop hunting for a prettier one.
      if (best && baseUrban && Date.now() > deadlineMs - 30_000) {
        break;
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[loopforge] variant failed:", error);
      }
    }
  }

  // Deadline / fetch-cap may have left best empty — promote before recovery.
  if (!best) {
    tryPromoteRelaxedPool();
  }

  if (!best && bestRejected) {
    const rejectedMetrics = loopQualityMetrics(
      bestRejected.coordinates,
      request.distanceKm,
      bestRejected.distanceKm,
      request.start,
      request.direction,
    );
    const rejectedApproachOverlap = options?.approachCoordinates
      ? approachOverlapShare(
          bestRejected.coordinates,
          options.approachCoordinates,
        )
      : 0;
    const hasVias = (request.viaPoints?.length ?? 0) > 0;
    const rejectedDistanceLimit = options?.approachCoordinates
      ? Math.max(
          maxAcceptableDistanceError(request.distanceKm, true, baseUrban),
          MAX_DISTANCE_ERROR_APPROACH_RELAXED,
        )
      : maxAcceptableDistanceError(
          request.distanceKm,
          true,
          baseUrban,
        );
    if (
      rejectedMetrics.directionCoverage >= 0.38 &&
      rejectedMetrics.distanceError < rejectedDistanceLimit &&
      bestRejected.distanceKm >= minLoopKm &&
      rejectedApproachOverlap <= MAX_APPROACH_OVERLAP_RELAXED &&
      !hasHardTeleportEdge(bestRejected.coordinates) &&
      passesDeliverableGeometry(bestRejected.coordinates, {
        targetDistanceKm: request.distanceKm,
        actualDistanceKm: bestRejected.distanceKm,
        start: request.start,
        direction: request.direction,
        approachMode: options?.approachCoordinates != null,
        urban: baseUrban,
        relaxed: true,
        preferQuiet: Boolean(request.preferQuietRoutes),
      })
    ) {
      best = bestRejected;
      usedRelaxedFallback = true;
    }
  }

  if (!best && bestFallback) {
    const fallbackMetrics = loopQualityMetrics(
      bestFallback.coordinates,
      request.distanceKm,
      bestFallback.distanceKm,
      request.start,
      request.direction,
    );
    const fallbackApproachOverlap = options?.approachCoordinates
      ? approachOverlapShare(
          bestFallback.coordinates,
          options.approachCoordinates,
        )
      : 0;
    const fallbackDistanceLimit = options?.approachCoordinates
      ? Math.max(
          maxAcceptableDistanceError(request.distanceKm, true, baseUrban),
          MAX_DISTANCE_ERROR_APPROACH_RELAXED,
        )
      : maxAcceptableDistanceError(
          request.distanceKm,
          true,
          baseUrban,
        );
    if (
      fallbackMetrics.directionCoverage >= 0.32 &&
      fallbackMetrics.distanceError < fallbackDistanceLimit &&
      bestFallback.distanceKm >= minLoopKm &&
      fallbackApproachOverlap <= MAX_APPROACH_OVERLAP_RELAXED &&
      !hasHardTeleportEdge(bestFallback.coordinates) &&
      passesDeliverableGeometry(bestFallback.coordinates, {
        targetDistanceKm: request.distanceKm,
        actualDistanceKm: bestFallback.distanceKm,
        start: request.start,
        direction: request.direction,
        approachMode: options?.approachCoordinates != null,
        urban: baseUrban,
        relaxed: true,
        preferQuiet: Boolean(request.preferQuietRoutes),
      })
    ) {
      best = bestFallback;
      usedRelaxedFallback = true;
    }
  }

  if (!best && Date.now() < deadlineMs && routedFetches < maxRoutedFetches) {
    for (const variant of [0, 1, 2, 3, 4]) {
      if (Date.now() > deadlineMs) break;
      if (routedFetches >= maxRoutedFetches) break;
      try {
        const recoveryPrefs = mergeLoopPrefs(
          profilePrefs,
          urbanWaypointAdjustments(request.distanceKm, true, baseUrban),
        );
        const shape = loopShapeForVariant(
          request.distanceKm,
          variant,
          recoveryPrefs,
        );
        const viaCoords =
          request.viaPoints?.map((p) => ({ lat: p.lat, lng: p.lng })) ?? [];
        // Later recovery variants drop homeStart shift — it can force
        // mirrored out-and-backs when the approach corridor eats the graph.
        const recoveryHome =
          options?.homeStart && variant < 1
            ? { homeStart: options.homeStart }
            : undefined;
        // Recovery scales — bias larger so we clear the 75% ship floor after
        // avoid/quiet undershoots (stress GEN_FAIL pattern).
        const recoveryScale =
          request.bikeType === "road"
            ? baseUrban
              ? [0.85, 1.0, 1.15, 1.3, 1.45][variant]!
              : [0.9, 1.05, 1.18, 1.3, 1.42][variant]!
            : baseUrban
              ? [0.9, 1.05, 1.18, 1.32, 1.48][variant]!
              : [0.95, 1.08, 1.2, 1.35, 1.48][variant]!;
        const waypoints = buildLoopWaypointsWithVia(
          request.start,
          request.distanceKm,
          request.direction,
          variant,
          recoveryScale,
          shape,
          false,
          jitter,
          viaCoords,
          recoveryHome,
          recoveryPrefs,
        );
        routedFetches += 1;
        const routed = await fetchLoopRouteResilient(fetchRoute, {
          start: request.start,
          bikeType: request.bikeType,
          waypoints,
          rideProfile: request.profile,
          avoidAsphalt: false,
          // Recovery must clear audit — quiet/avoid inflate spur and forbidden.
          preferQuietRoutes: false,
          urbanRouting: true,
          skipGpx: true,
        });
        if (hasHardTeleportEdge(routed.coordinates)) continue;
        const { refined, metrics } = applySpurRefinement(
          routed,
          request.distanceKm,
          request.start,
          request.direction,
          shape,
          false,
          options?.approachCoordinates,
          (request.viaPoints?.length ?? 0) > 0,
          recoveryPrefs,
          false,
        );
        const recoveryShareOk =
          refined.distanceKm >= request.distanceKm * MIN_LOOP_SHARE_EMERGENCY &&
          refined.distanceKm <=
            request.distanceKm *
              (options?.approachCoordinates
                ? approachMaxLoopShare(baseUrban)
                : maxLoopShareOfTarget(request.distanceKm, true, baseUrban));
        const recoveryEmergencyShareOk =
          refined.distanceKm >= request.distanceKm * MIN_LOOP_SHARE_EMERGENCY &&
          refined.distanceKm <=
            request.distanceKm * emergencyMaxLoopShare(request.bikeType);
        const recoveryGate = passesDeliverableGeometry(refined.coordinates, {
          targetDistanceKm: request.distanceKm,
          actualDistanceKm: refined.distanceKm,
          start: request.start,
          direction: request.direction,
          approachMode: options?.approachCoordinates != null,
          urban: baseUrban,
          relaxed: true,
          preferQuiet: false,
        });
        const recoveryEmergencyGate = passesDeliverableGeometry(
          refined.coordinates,
          {
            targetDistanceKm: request.distanceKm,
            actualDistanceKm: refined.distanceKm,
            start: request.start,
            direction: request.direction,
            approachMode: options?.approachCoordinates != null,
            urban: baseUrban,
            relaxed: true,
            preferQuiet: false,
            emergency: true,
          },
        );
        if (
          !hasHardTeleportEdge(refined.coordinates) &&
          refined.coordinates.length >= 4 &&
          ((recoveryShareOk && recoveryGate) ||
            (recoveryEmergencyShareOk && recoveryEmergencyGate)) &&
          !hasHardSidepathAccess(refined.segments) &&
          !hasForbiddenBikeAccess(refined.segments)
        ) {
          best = refined;
          usedRelaxedFallback = true;
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              "[loopforge] recovery accepted:",
              `${refined.distanceKm.toFixed(1)} km`,
              `dir=${metrics.directionCoverage.toFixed(2)}`,
            );
          }
          break;
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[loopforge] recovery variant failed:", error);
        }
      }
    }
  }

  if (!best && bestLowOverlap) {
    const lowOverlapMaxShare = options?.approachCoordinates
      ? approachMaxLoopShare(baseUrban)
      : maxLoopShareOfTarget(request.distanceKm, true, baseUrban);
    if (
      bestLowOverlap.distanceKm <=
        request.distanceKm * lowOverlapMaxShare &&
      !hasHardTeleportEdge(bestLowOverlap.coordinates) &&
      passesDeliverableGeometry(bestLowOverlap.coordinates, {
        targetDistanceKm: request.distanceKm,
        actualDistanceKm: bestLowOverlap.distanceKm,
        start: request.start,
        direction: request.direction,
        approachMode: options?.approachCoordinates != null,
        urban: baseUrban,
        relaxed: true,
        preferQuiet: Boolean(request.preferQuietRoutes),
      })
    ) {
      best = bestLowOverlap;
      usedRelaxedFallback = true;
    }
  }

  if (
    !best &&
    bestFallback &&
    !hasHardTeleportEdge(bestFallback.coordinates) &&
    bestFallback.coordinates.length >= 4 &&
    bestFallback.distanceKm >= request.distanceKm * MIN_LOOP_SHARE_EMERGENCY &&
    bestFallback.distanceKm <=
      request.distanceKm *
        (options?.approachCoordinates
          ? approachMaxLoopShare(baseUrban)
          : maxLoopShareOfTarget(request.distanceKm, true, baseUrban)) &&
    passesDeliverableGeometry(bestFallback.coordinates, {
      targetDistanceKm: request.distanceKm,
      actualDistanceKm: bestFallback.distanceKm,
      start: request.start,
      direction: request.direction,
      approachMode: options?.approachCoordinates != null,
      urban: baseUrban,
      relaxed: true,
        preferQuiet: Boolean(request.preferQuietRoutes),
    })
  ) {
    best = bestFallback;
    usedRelaxedFallback = true;
  }

  // Prefer any real routed loop that still clears geometry quality gates.
  if (!best) {
    const maxShare = options?.approachCoordinates
      ? approachMaxLoopShare(baseUrban)
      : maxLoopShareOfTarget(request.distanceKm, true, baseUrban);
    const approachMode = options?.approachCoordinates != null;
    const candidates = [
      bestRejected,
      bestFallback,
      bestLowOverlap,
    ].filter(
      (c): c is RoutedLoopResult =>
        !!c &&
        c.coordinates.length >= 4 &&
        c.distanceKm >= request.distanceKm * MIN_LOOP_SHARE_EMERGENCY &&
        c.distanceKm <= request.distanceKm * maxShare &&
        !hasHardTeleportEdge(c.coordinates) &&
        !hasHardSidepathAccess(c.segments) &&
        !hasForbiddenBikeAccess(c.segments) &&
        passesDeliverableGeometry(c.coordinates, {
          targetDistanceKm: request.distanceKm,
          actualDistanceKm: c.distanceKm,
          start: request.start,
          direction: request.direction,
          approachMode,
          urban: baseUrban,
          relaxed: true,
        preferQuiet: Boolean(request.preferQuietRoutes),
        }),
    );
    if (candidates.length > 0) {
      candidates.sort(
        (a, b) =>
          geometryPenalty(
            a.coordinates,
            request.distanceKm,
            a.distanceKm,
            request.start,
            request.direction,
            approachMode,
          ) -
          geometryPenalty(
            b.coordinates,
            request.distanceKm,
            b.distanceKm,
            request.start,
            request.direction,
            approachMode,
          ),
      );
      best = candidates[0]!;
      usedRelaxedFallback = true;
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[loopforge] last-resort candidate:",
          `${best.distanceKm.toFixed(1)} km`,
        );
      }
    }
  }

  // Prefer shipping an imperfect loop over a hard gen-fail (road islands / sparse graph).
  if (!best) {
    const maxShare = emergencyMaxLoopShare(request.bikeType);
    const approachMode = options?.approachCoordinates != null;
    const emergencyPool = [
      bestRejected,
      bestFallback,
      bestLowOverlap,
    ].filter(
      (c): c is RoutedLoopResult =>
        !!c &&
        c.coordinates.length >= 4 &&
        c.distanceKm >= request.distanceKm * MIN_LOOP_SHARE_EMERGENCY &&
        c.distanceKm <= request.distanceKm * maxShare &&
        !hasHardTeleportEdge(c.coordinates) &&
        !hasHardSidepathAccess(c.segments) &&
        !hasForbiddenBikeAccess(c.segments) &&
        passesDeliverableGeometry(c.coordinates, {
          targetDistanceKm: request.distanceKm,
          actualDistanceKm: c.distanceKm,
          start: request.start,
          direction: request.direction,
          approachMode,
          urban: baseUrban,
          relaxed: true,
          preferQuiet: Boolean(request.preferQuietRoutes),
          emergency: true,
        }),
    );
    if (emergencyPool.length > 0) {
      emergencyPool.sort(
        (a, b) =>
          geometryPenalty(
            a.coordinates,
            request.distanceKm,
            a.distanceKm,
            request.start,
            request.direction,
            approachMode,
          ) -
          geometryPenalty(
            b.coordinates,
            request.distanceKm,
            b.distanceKm,
            request.start,
            request.direction,
            approachMode,
          ),
      );
      best = emergencyPool[0]!;
      usedRelaxedFallback = true;
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[loopforge] emergency candidate:",
          `${best.distanceKm.toFixed(1)} km`,
        );
      }
    }
  }

  if (!best) {
    const urbanHint = baseUrban
      ? " W aglomeracji spróbuj krótszego dystansu albo startu za miastem."
      : "";
    if (process.env.LOOPFORGE_DEBUG_ACCESS === "1") {
      const sample = bestRejected ?? bestFallback;
      if (sample) {
        const m = loopQualityMetrics(
          sample.coordinates,
          request.distanceKm,
          sample.distanceKm,
          request.start,
          request.direction,
        );
        const mirrorM = mirroredPrefixLengthM(sample.coordinates);
        const geoOk = passesDeliverableGeometry(sample.coordinates, {
          targetDistanceKm: request.distanceKm,
          actualDistanceKm: sample.distanceKm,
          start: request.start,
          direction: request.direction,
          approachMode: options?.approachCoordinates != null,
          urban: baseUrban,
          relaxed: true,
          preferQuiet: Boolean(request.preferQuietRoutes),
        });
        console.warn(
          `[loopforge] no best detail: dist=${sample.distanceKm.toFixed(1)} err=${m.distanceError.toFixed(3)} dir=${m.directionCoverage.toFixed(2)} spur=${(m.spurShare * 100).toFixed(1)}% back=${(m.backtrack * 100).toFixed(1)}% mirror=${Math.round(mirrorM)}m geoOk=${geoOk} minLoop=${minLoopKm.toFixed(1)}`,
        );
      } else {
        console.warn(
          `[loopforge] no best: rejected=null fallback=null lowOverlap=null`,
        );
      }
    }
    throw new Error(
      `Nie udało się wygenerować trasy — spróbuj innego kierunku, krótszego dystansu lub wyłącz „unikaj asfaltu”.${urbanHint}`,
    );
  }

  reportProgress(onProgress, {
    phase: "finalizing",
    message: "Satynuję i pakuję GPX",
    detail: usedRelaxedFallback
      ? "Dopięcie trasy (tryb awaryjny — jakość może być niższa)"
      : "Ostatnie szlify przed mapą",
    progress: 94,
  });

  const hasViaPoints = (request.viaPoints?.length ?? 0) > 0;
  const approachMode = options?.approachCoordinates != null;
  const minDirectionCoverage = usedRelaxedFallback
    ? 0.22
    : approachMode
      ? 0.36
      : 0.42;
  const distanceErrorLimit = usedRelaxedFallback
    ? Math.max(
        maxAcceptableDistanceError(request.distanceKm, true, baseUrban),
        approachMode ? MAX_DISTANCE_ERROR_APPROACH_RELAXED : 0,
      )
    : maxAcceptableDistanceError(request.distanceKm, false, baseUrban);

  let finalMetrics = loopQualityMetrics(
    best.coordinates,
    request.distanceKm,
    best.distanceKm,
    request.start,
    request.direction,
  );

  if (
    (finalMetrics.directionCoverage < minDirectionCoverage ||
      finalMetrics.distanceError > distanceErrorLimit) &&
    bestLowOverlap &&
    bestLowOverlap !== best
  ) {
    const lowOverlapMetrics = loopQualityMetrics(
      bestLowOverlap.coordinates,
      request.distanceKm,
      bestLowOverlap.distanceKm,
      request.start,
      request.direction,
    );
    if (
      lowOverlapMetrics.directionCoverage >= minDirectionCoverage &&
      lowOverlapMetrics.distanceError <= distanceErrorLimit &&
      !hasHardTeleportEdge(bestLowOverlap.coordinates) &&
      passesDeliverableGeometry(bestLowOverlap.coordinates, {
        targetDistanceKm: request.distanceKm,
        actualDistanceKm: bestLowOverlap.distanceKm,
        start: request.start,
        direction: request.direction,
        approachMode,
        urban: baseUrban,
        relaxed: true,
        preferQuiet: Boolean(request.preferQuietRoutes),
      })
    ) {
      best = bestLowOverlap;
      finalMetrics = lowOverlapMetrics;
      usedRelaxedFallback = true;
    }
  }

  const minLoopKmFinal = usedRelaxedFallback
    ? request.distanceKm * MIN_LOOP_SHARE_EMERGENCY
    : Math.max(minLoopKm, request.distanceKm * MIN_LOOP_SHARE_SHIP);

  if (
    finalMetrics.directionCoverage < minDirectionCoverage ||
    finalMetrics.distanceError > distanceErrorLimit ||
    best.distanceKm < minLoopKmFinal
  ) {
    const maxShare = approachMode
      ? approachMaxLoopShare(baseUrban)
      : maxLoopShareOfTarget(request.distanceKm, true, baseUrban);
    const emergencyShare = emergencyMaxLoopShare(request.bikeType);
    // Keep imperfect distance only when geometry is still rideable — never
    // below the emergency floor (blocks 60→34-style undershoots).
    if (
      best.coordinates.length >= 4 &&
      best.distanceKm >= request.distanceKm * MIN_LOOP_SHARE_SHIP &&
      best.distanceKm <= request.distanceKm * maxShare &&
      passesDeliverableGeometry(best.coordinates, {
        targetDistanceKm: request.distanceKm,
        actualDistanceKm: best.distanceKm,
        start: request.start,
        direction: request.direction,
        approachMode,
        urban: baseUrban,
        relaxed: true,
        preferQuiet: Boolean(request.preferQuietRoutes),
      })
    ) {
      usedRelaxedFallback = true;
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[loopforge] accepting imperfect loop:",
          `${best.distanceKm.toFixed(1)} km`,
          `dir=${finalMetrics.directionCoverage.toFixed(2)}`,
          `err=${finalMetrics.distanceError.toFixed(2)}`,
        );
      }
    } else if (
      best.coordinates.length >= 4 &&
      best.distanceKm >= request.distanceKm * MIN_LOOP_SHARE_EMERGENCY &&
      best.distanceKm <= request.distanceKm * emergencyShare &&
      !hasHardSidepathAccess(best.segments) &&
      !hasForbiddenBikeAccess(best.segments) &&
      passesDeliverableGeometry(best.coordinates, {
        targetDistanceKm: request.distanceKm,
        actualDistanceKm: best.distanceKm,
        start: request.start,
        direction: request.direction,
        approachMode,
        urban: baseUrban,
        relaxed: true,
        preferQuiet: Boolean(request.preferQuietRoutes),
        emergency: true,
      })
    ) {
      usedRelaxedFallback = true;
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[loopforge] accepting emergency loop:",
          `${best.distanceKm.toFixed(1)} km`,
          `dir=${finalMetrics.directionCoverage.toFixed(2)}`,
          `err=${finalMetrics.distanceError.toFixed(2)}`,
        );
      }
    } else {
      const urbanHint = baseUrban
        ? " W mieście 50 km bywa trudne — spróbuj 35 km albo start za granicą aglomeracji."
        : "";
      throw new Error(
        best.distanceKm > request.distanceKm * emergencyShare
          ? `Trasa wyszła za długa (${best.distanceKm.toFixed(1)} km zamiast ~${request.distanceKm} km) — spróbuj innego kierunku lub krótszego dystansu.`
          : hasViaPoints && finalMetrics.distanceError > distanceErrorLimit
            ? `Trasa z punktami przejazdu wyszła za krótka (${best.distanceKm.toFixed(1)} km zamiast ~${request.distanceKm} km) — dodaj punkty bliżej obwodu pętli lub zmniejsz dystans.`
            : `Nie udało się dopasować trasy do dystansu i kierunku (${best.distanceKm.toFixed(1)} km zamiast ~${request.distanceKm} km).${urbanHint}`,
      );
    }
  }

  const finalized = finalizeLoopWithoutSpurs(
    best,
    request.start,
    request.distanceKm,
    request.direction,
  );

  const finalizedGeoOk =
    passesDeliverableGeometry(finalized.coordinates, {
      targetDistanceKm: request.distanceKm,
      actualDistanceKm: finalized.distanceKm,
      start: request.start,
      direction: request.direction,
      approachMode,
      urban: baseUrban,
      relaxed: true,
      preferQuiet: Boolean(request.preferQuietRoutes),
    }) ||
    (usedRelaxedFallback &&
      passesDeliverableGeometry(finalized.coordinates, {
        targetDistanceKm: request.distanceKm,
        actualDistanceKm: finalized.distanceKm,
        start: request.start,
        direction: request.direction,
        approachMode,
        urban: baseUrban,
        relaxed: true,
        preferQuiet: Boolean(request.preferQuietRoutes),
        emergency: true,
      }));

  if (!finalizedGeoOk) {
    const urbanHint = baseUrban
      ? " W aglomeracji spróbuj krótszego dystansu albo startu za miastem."
      : "";
    throw new Error(
      `Nie udało się wygenerować czystej pętli (ślepe zaułki / jazda pod prąd). Spróbuj innego kierunku lub krótszego dystansu.${urbanHint}`,
    );
  }

  // Hard distance ceiling — never ship 1.5–2× requests (gravel express etc.).
  const maxShipShare = approachMode
    ? approachMaxLoopShare(baseUrban)
    : emergencyMaxLoopShare(request.bikeType);
  if (finalized.distanceKm > request.distanceKm * maxShipShare) {
    throw new Error(
      `Trasa wyszła za długa (${finalized.distanceKm.toFixed(1)} km zamiast ~${request.distanceKm} km) — spróbuj innego kierunku lub krótszego dystansu.`,
    );
  }

  // Hard distance floor — aligned with audit DIST_UNDERSHOOT (75%).
  // Before failing, try a dedicated stretch rescue (no quiet/avoid).
  const minShipShare = MIN_LOOP_SHARE_SHIP;
  if (finalized.distanceKm < request.distanceKm * minShipShare) {
    const rescueDeadline = deadlineMs;
    const rescueScales = [1.15, 1.3, 1.45, 1.6];
    let rescued: RoutedLoopResult | null = null;
    if (Date.now() < rescueDeadline && routedFetches < maxRoutedFetches + 2) {
      reportProgress(onProgress, {
        phase: "refining",
        message: "Docinam kilometry",
        detail: `Za krótko (${finalized.distanceKm.toFixed(1)} km) — jeszcze jedna próba poszerzenia`,
        progress: 91,
      });
      const rescuePrefs = mergeLoopPrefs(
        profilePrefs,
        urbanWaypointAdjustments(request.distanceKm, true, baseUrban),
      );
      for (let ri = 0; ri < rescueScales.length; ri++) {
        if (Date.now() > rescueDeadline) break;
        if (routedFetches >= maxRoutedFetches + 2) break;
        try {
          const shape = loopShapeForVariant(
            request.distanceKm,
            ri % 5,
            rescuePrefs,
          );
          const viaCoords =
            request.viaPoints?.map((p) => ({ lat: p.lat, lng: p.lng })) ?? [];
          const waypoints = buildLoopWaypointsWithVia(
            request.start,
            request.distanceKm,
            request.direction,
            ri % 5,
            rescueScales[ri]!,
            shape,
            false,
            jitter,
            viaCoords,
            undefined,
            rescuePrefs,
          );
          routedFetches += 1;
          const routed = await fetchLoopRouteResilient(fetchRoute, {
            start: request.start,
            bikeType: request.bikeType,
            waypoints,
            rideProfile: request.profile,
            avoidAsphalt: false,
            preferQuietRoutes: false,
            urbanRouting: true,
            skipGpx: true,
          });
          if (hasHardTeleportEdge(routed.coordinates)) continue;
          if (hasHardSidepathAccess(routed.segments)) continue;
          if (hasForbiddenBikeAccess(routed.segments)) continue;
          const { refined } = applySpurRefinement(
            routed,
            request.distanceKm,
            request.start,
            request.direction,
            shape,
            false,
            options?.approachCoordinates,
            (request.viaPoints?.length ?? 0) > 0,
            rescuePrefs,
            false,
          );
          const shareOk =
            refined.distanceKm >= request.distanceKm * MIN_LOOP_SHARE_SHIP &&
            refined.distanceKm <=
              request.distanceKm * emergencyMaxLoopShare(request.bikeType);
          if (
            shareOk &&
            passesDeliverableGeometry(refined.coordinates, {
              targetDistanceKm: request.distanceKm,
              actualDistanceKm: refined.distanceKm,
              start: request.start,
              direction: request.direction,
              approachMode,
              urban: baseUrban,
              relaxed: true,
              preferQuiet: false,
              emergency: true,
            })
          ) {
            rescued = refined;
            usedRelaxedFallback = true;
            break;
          }
        } catch {
          // try next rescue scale
        }
      }
    }

    if (rescued) {
      best = rescued;
      const reFinalized = finalizeLoopWithoutSpurs(
        best,
        request.start,
        request.distanceKm,
        request.direction,
      );
      if (
        reFinalized.distanceKm >= request.distanceKm * minShipShare &&
        passesDeliverableGeometry(reFinalized.coordinates, {
          targetDistanceKm: request.distanceKm,
          actualDistanceKm: reFinalized.distanceKm,
          start: request.start,
          direction: request.direction,
          approachMode,
          urban: baseUrban,
          relaxed: true,
          preferQuiet: false,
          emergency: true,
        }) &&
        !exceedsMirrorBudget(
          reFinalized.coordinates,
          request.distanceKm,
          request.start,
          approachMode,
        )
      ) {
        const output = reFinalized;
        return {
          route: buildGeneratedRoute(request, output.coordinates, {
            placeholder: false,
            elevationGainM: output.elevationGainM,
            segments: output.segments,
            mapGeojson: output.mapGeojson ?? undefined,
            brouterMessages: output.brouterMessages,
          }),
          loopSegments: output.segments,
        };
      }
    }

    throw new Error(
      `Trasa wyszła za krótka (${finalized.distanceKm.toFixed(1)} km zamiast ~${request.distanceKm} km) — spróbuj innego kierunku lub większego dystansu.`,
    );
  }

  // Mirror on densified nav polyline (same densify path as GPX) so audit and
  // ship gate agree — sparse coords under-counted reverse overlap.
  if (
    exceedsMirrorBudget(
      finalized.coordinates,
      request.distanceKm,
      request.start,
      approachMode,
    )
  ) {
    throw new Error(
      `Nie udało się wygenerować czystej pętli (powrót tą samą drogą ~${Math.round(densifiedMirrorLengthM(finalized.coordinates, request.start))} m). Spróbuj innego kierunku lub krótszego dystansu.`,
    );
  }

  // Always keep pruned geometry — restoring pre-prune reintroduces dead-end stubs.
  const output = finalized;

  return {
    route: buildGeneratedRoute(request, output.coordinates, {
      placeholder: false,
      elevationGainM: output.elevationGainM,
      segments: output.segments,
      mapGeojson: output.mapGeojson ?? undefined,
      brouterMessages: output.brouterMessages,
    }),
    loopSegments: output.segments,
  };
}

function generatePlaceholderRoute(
  request: GenerateRouteRequest,
  options?: GenerateRouteOptions,
): {
  route: GeneratedRoute;
  loopSegments: { tags: OsmTags; distanceM: number }[];
} {
  reportProgress(options?.onProgress, {
    phase: "routing",
    message: "Kuźnia offline — szkic zastępczy",
    detail: "Buduję geometryczną trasę zastępczą",
    progress: 40,
  });

  const coordinates = buildPlaceholderLoop(
    request.start,
    request.direction,
    request.distanceKm,
  );
  const actualKm = totalDistanceKm(coordinates);

  reportProgress(options?.onProgress, {
    phase: "finalizing",
    message: "Satynuję i pakuję GPX",
    detail: "Ostatnie szlify przed mapą",
    progress: 94,
  });

  return {
    route: buildGeneratedRoute(request, coordinates, {
      placeholder: true,
      elevationGainM: Math.round(actualKm * 12),
      segments: [
        {
          tags: { highway: "track", surface: "gravel" },
          distanceM: actualKm * 500,
        },
        {
          tags: { highway: "cycleway", surface: "compacted" },
          distanceM: actualKm * 500,
        },
      ],
    }),
    loopSegments: [
      {
        tags: { highway: "track", surface: "gravel" },
        distanceM: actualKm * 500,
      },
      {
        tags: { highway: "cycleway", surface: "compacted" },
        distanceM: actualKm * 500,
      },
    ],
  };
}

function appendApproachCoordinates(
  target: [number, number][],
  incoming: [number, number][],
): void {
  if (incoming.length === 0) return;
  if (target.length === 0) {
    target.push(...incoming);
    return;
  }
  const last = target[target.length - 1]!;
  const first = incoming[0]!;
  if (last[0] === first[0] && last[1] === first[1]) {
    target.push(...incoming.slice(1));
  } else {
    target.push(...incoming);
  }
}

function brouterResultToApproachLeg(
  routed: Awaited<ReturnType<typeof fetchBrouterApproach>>,
): RoutedLeg {
  return {
    coordinates: routed.coordinates,
    distanceKm: routed.distanceKm,
    elevationGainM: routed.elevationGainM,
    segments: routed.segments,
    mapGeojson: routed.mapGeojson,
  };
}

async function fetchApproachLegSegment(
  from: LatLng,
  to: LatLng,
  _bikeType: GenerateRouteRequest["bikeType"],
): Promise<RoutedLeg> {
  const preference = routingEnginePreference();

  if (preference !== "brouter") {
    const pgReady = await isRoutingReady();
    if (pgReady) {
      const routed = await fetchPgApproach({ from, to, skipGpx: true });
      return {
        coordinates: routed.coordinates,
        distanceKm: routed.distanceKm,
        elevationGainM: routed.elevationGainM,
        segments: routed.segments,
        mapGeojson: routed.mapGeojson,
      };
    }
    if (preference === "pgrouting") {
      throw new Error(
        "pgRouting is not ready — run supabase db push and pnpm import:osm",
      );
    }
  }

  const brouterConfig = getBrouterConfig();
  if (brouterConfig) {
    const routed = await fetchBrouterApproach(brouterConfig, {
      from,
      to,
      skipGpx: true,
    });
    return brouterResultToApproachLeg(routed);
  }

  const coordinates = [...lineCoordinates(from, to)] as [number, number][];
  const distanceKm = totalDistanceKm(coordinates);
  return {
    coordinates,
    distanceKm,
    elevationGainM: 0,
    segments: [
      {
        tags: { highway: "cycleway", surface: "asphalt" },
        distanceM: distanceKm * 1000,
      },
    ],
    mapGeojson: undefined,
  };
}

async function fetchApproachLeg(
  from: LatLng,
  to: LatLng,
  bikeType: GenerateRouteRequest["bikeType"],
  corridorWaypoints: LatLng[] = [],
): Promise<RoutedLeg> {
  const chain = [from, ...corridorWaypoints, to];
  const brouterConfig = getBrouterConfig();
  const preference = routingEnginePreference();

  if (brouterConfig && preference !== "pgrouting") {
    const routePoints = async (points: LatLng[]) => {
      if (points.length === 2) {
        const routed = await fetchBrouterApproach(brouterConfig, {
          from: points[0]!,
          to: points[1]!,
          skipGpx: true,
        });
        return brouterResultToApproachLeg(routed);
      }
      const routed = await fetchBrouterApproachThrough(brouterConfig, {
        points,
        skipGpx: true,
      });
      return brouterResultToApproachLeg(routed);
    };

    let leg = await routePoints(chain);
    if (approachLooksLikeCemeteryDetour(leg, from, to)) {
      const direct = await routePoints([from, to]);
      if (
        !approachLooksLikeCemeteryDetour(direct, from, to) ||
        direct.distanceKm < leg.distanceKm * 0.98
      ) {
        leg = direct;
      }
    }
    return leg;
  }

  if (chain.length === 2) {
    return fetchApproachLegSegment(from, to, bikeType);
  }

  const coordinates: [number, number][] = [];
  let elevationGainM = 0;
  const segments: RoutedLeg["segments"] = [];

  for (let i = 0; i < chain.length - 1; i++) {
    const leg = await fetchApproachLegSegment(
      chain[i]!,
      chain[i + 1]!,
      bikeType,
    );
    appendApproachCoordinates(coordinates, leg.coordinates);
    elevationGainM += leg.elevationGainM;
    segments.push(...leg.segments);
  }

  return {
    coordinates,
    distanceKm: totalDistanceKm(coordinates),
    elevationGainM,
    segments,
    mapGeojson: undefined,
  };
}

async function generateRouteWithApproach(
  request: GenerateRouteRequest,
  options?: GenerateRouteOptions,
): Promise<GeneratedRoute> {
  const userStart = request.start;
  const entryTarget = computeLoopEntryTarget(
    userStart,
    request.direction,
    request.distanceKm,
    request.approachDistanceKm,
  );
  const approachTargetKm =
    request.approachDistanceKm ??
    Math.round(loopEntryOffsetM(request.distanceKm) / 100) / 10;
  const { onProgress } = options ?? {};

  reportProgress(onProgress, {
    phase: "approach",
    message: "Kuję prolog do pętli",
    detail: `~${approachTargetKm} km w kierunku ${DIRECTION_LABEL_PL[request.direction]}`,
    progress: 8,
  });

  const corridorWaypoints = buildApproachCorridorWaypoints(
    userStart,
    entryTarget,
  );
  const approachRaw = await fetchApproachLeg(
    userStart,
    entryTarget,
    request.bikeType,
    corridorWaypoints,
  );
  const approachSanitized = pruneApproachLeg(approachRaw, userStart);
  const refined = refineApproachForLoopEntry(approachSanitized, {
    home: userStart,
    entryTarget,
  });
  const approachTrimmed =
    refined.approachCoordinates.length <
    approachSanitized.coordinates.length;
  const approachMapGeojson = approachTrimmed
    ? pruneMapGeoJson(
        approachSanitized.mapGeojson ?? null,
        refined.approachCoordinates,
      )
    : approachSanitized.mapGeojson;
  const approach: RoutedLeg = {
    ...approachSanitized,
    coordinates: refined.approachCoordinates,
    distanceKm: refined.approachDistanceKm,
    mapGeojson: approachMapGeojson ?? undefined,
  };
  const loopEntry = refined.loopEntry;

  if (request.viaPoints?.length) {
    const viaCheck = validateViaPointsForRoute(
      {
        start: userStart,
        direction: request.direction,
        distanceKm: request.distanceKm,
        loopAnchor: loopEntry,
      },
      request.viaPoints,
    );
    if (!viaCheck.ok) {
      throw new Error(
        viaCheck.message ??
          "Punkty przejazdu nie pasują do startu pętli po dojeździe.",
      );
    }
  }

  reportProgress(onProgress, {
    phase: "approach",
    message: "Prolog przetopiony",
    detail: `${approach.distanceKm.toFixed(1)} km — start pętli przy drodze`,
    progress: 14,
  });

  const loopRequest: GenerateRouteRequest = {
    ...request,
    start: loopEntry,
    approachEnabled: false,
  };

  const loopOptions: GenerateRouteOptions = {
    ...options,
    approachCoordinates: approach.coordinates,
    homeStart: userStart,
  };

  const { route: loop, loopSegments } = await generateLoopRoute(
    loopRequest,
    loopOptions,
  );

  return mergeApproachAndLoop(
    request,
    userStart,
    loopEntry,
    approach,
    loop,
    loopSegments,
  );
}

async function generateLoopRoute(
  request: GenerateRouteRequest,
  options?: GenerateRouteOptions,
): Promise<{
  route: GeneratedRoute;
  loopSegments: { tags: OsmTags; distanceM: number }[];
}> {
  const preference = routingEnginePreference();

  if (preference !== "brouter") {
    const pgReady = await isRoutingReady();
    if (pgReady) {
      return generateRouteWithEngine(
        request,
        async (params) => {
          const routed = await fetchPgRoute(params);
          return {
            coordinates: routed.coordinates,
            distanceKm: routed.distanceKm,
            elevationGainM: routed.elevationGainM,
            segments: routed.segments,
            mapGeojson: routed.mapGeojson,
            gpx: routed.gpx,
          };
        },
        options,
      );
    }
    if (preference === "pgrouting") {
      throw new Error(
        "pgRouting is not ready — run supabase db push and pnpm import:osm",
      );
    }
  }

  const brouterConfig = getBrouterConfig();
  if (brouterConfig) {
    return generateRouteWithEngine(
      request,
      async (params) => {
        const routed = await fetchBrouterRoute(brouterConfig, params);
        return {
          coordinates: routed.coordinates,
          distanceKm: routed.distanceKm,
          elevationGainM: routed.elevationGainM,
          segments: routed.segments,
          mapGeojson: routed.mapGeojson ?? undefined,
          gpx: routed.gpx,
          brouterMessages: routed.brouterMessages,
        };
      },
      options,
    );
  }

  console.warn("[loopforge] No routing backend — using geometric placeholder");
  return generatePlaceholderRoute(request, options);
}

function routingEnginePreference(): "auto" | "pgrouting" | "brouter" {
  const value = process.env.ROUTING_ENGINE?.trim().toLowerCase();
  if (value === "pgrouting" || value === "brouter") return value;
  return "auto";
}

export { prepareCoordinatesForNavigation } from "./prune-spurs";
export {
  auditGeneratedRoute,
  auditLongEdgesWithRouter,
  auditRouteGeometry,
  distanceToPolylineM,
  formatRouteQualityReport,
  measureOffPath,
  mirroredPrefixLengthM,
  segmentAccessIssues,
  type RouteQualityAudit,
  type RouteQualityFinding,
  type RouteQualityOptions,
} from "./route-quality";
export {
  inferGeometrySafetyLimits,
  metroShareOfCoordinates,
  routeEdgeLengthStats,
  useUrbanRouting,
} from "./urban-context";
export {
  MAX_VIA_POINTS,
  estimateLoopAnchor,
  validateViaPointForRoute,
  validateViaPointsForRoute,
} from "./via-validation";
export type {
  ViaPointRouteContext,
  ViaPointStatus,
  ViaPointValidation,
} from "./via-validation";

export async function generateRoute(
  request: GenerateRouteRequest,
  options?: GenerateRouteOptions,
): Promise<GeneratedRoute> {
  if (request.viaPoints?.length) {
    const validation = validateViaPointsForRoute(
      {
        start: request.start,
        direction: request.direction,
        distanceKm: request.distanceKm,
        approachEnabled: request.approachEnabled,
        approachDistanceKm: request.approachDistanceKm,
      },
      request.viaPoints,
    );
    if (!validation.ok) {
      throw new Error(
        validation.message ?? "Nieprawidłowe punkty przejazdu na trasie.",
      );
    }
  }

  if (request.approachEnabled) {
    return generateRouteWithApproach(request, options);
  }
  return (await generateLoopRoute(request, options)).route;
}
