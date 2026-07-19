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
  hasSuspiciousTeleportEdge,
} from "./prune-spurs";
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
  if (hasSuspiciousTeleportEdge(displayCoordinates, geoCtx)) {
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
  };
}

const MIN_PRUNE_REMOVED_M = 5;
const MAX_SPUR_SHARE = 0.035;
const MAX_BACKTRACK = 0.04;
const MAX_SCALE_PASSES = 4;
const SCALE_TARGET_DISTANCE_ERROR = 0.12;

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
    pruned.coordinates.length >= 4;
  let coordinates = usePruned ? pruned.coordinates : routed.coordinates;

  if (
    usePruned &&
    hasBrokenRouteGeometry(coordinates, routed.coordinates, geoCtx)
  ) {
    usePruned = false;
    coordinates = routed.coordinates;
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
): RoutedLoopResult {
  const geoCtx = { start };
  const pruned = pruneDeadEndSpurs(best.coordinates, geoCtx);
  if (
    pruned.removedRanges.length === 0 ||
    pruned.removedM < MIN_PRUNE_REMOVED_M ||
    pruned.coordinates.length < 4 ||
    hasBrokenRouteGeometry(pruned.coordinates, best.coordinates, geoCtx)
  ) {
    return best;
  }

  const coordinates = pruned.coordinates;
  const mapGeojson = syncMapGeoJson(coordinates, best);

  return {
    ...best,
    coordinates,
    mapGeojson,
    distanceKm: routeLengthM(coordinates) / 1000,
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
    Date.now() + (baseUrban ? 110_000 : 95_000);
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
  const maxAttemptsEstimate = variants * MAX_SCALE_PASSES;
  const minLoopKm =
    request.distanceKm * minLoopShareOfTarget(request.distanceKm, baseUrban);
  const { onProgress } = options ?? {};

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
    if (Date.now() > deadlineMs && best) break;

    try {
      const scales: number[] = [1.0];
      let variantDone = false;
      let variantUrbanEscalated = baseUrban;

      for (let si = 0; si < scales.length; si++) {
        if (Date.now() > deadlineMs && best) break;

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
        const waypoints = buildLoopWaypointsWithVia(
          request.start,
          request.distanceKm,
          request.direction,
          variant,
          scale,
          shape,
          request.avoidAsphalt ?? false,
          jitter,
          viaCoords,
          options?.homeStart ? { homeStart: options.homeStart } : undefined,
          loopPrefs,
        );
        const routed = await fetchLoopRouteResilient(fetchRoute, {
          start: request.start,
          bikeType: request.bikeType,
          waypoints,
          rideProfile: request.profile,
          avoidAsphalt: request.avoidAsphalt,
          preferQuietRoutes: request.preferQuietRoutes,
          urbanRouting: baseUrban || variantUrbanEscalated,
          skipGpx: true,
        });

        if (hasSuspiciousTeleportEdge(routed.coordinates, geoCtx)) continue;

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
          request.avoidAsphalt,
          options?.approachCoordinates,
          (request.viaPoints?.length ?? 0) > 0,
          loopPrefs,
          request.preferQuietRoutes ?? false,
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

        if (quality < bestFallbackScore) {
          bestFallbackScore = quality;
          bestFallback = refined;
        }

        // Extend scale when loop is too short (common in dense urban grids).
        if (
          refined.distanceKm < request.distanceKm * 0.98 &&
          metrics.distanceError > SCALE_TARGET_DISTANCE_ERROR &&
          scales.length < MAX_SCALE_PASSES &&
          Date.now() < deadlineMs - 6_000
        ) {
          const ratio = request.distanceKm / Math.max(refined.distanceKm, 1);
          const hasVias = (request.viaPoints?.length ?? 0) > 0;
          const stretch =
            ratio > 1
              ? 1 +
                (ratio - 1) *
                  (hasVias ? 0.92 : request.avoidAsphalt ? 0.48 : 0.96)
              : 0.98;
          const maxScale = baseUrban || variantUrbanEscalated
            ? Math.min(1.78, 1.18 + request.distanceKm / 260)
            : hasVias
              ? Math.min(1.45, 1.12 + request.distanceKm / 350)
              : request.avoidAsphalt
                ? Math.min(1.28, 1.08 + request.distanceKm / 400)
                : 1.55;
          const nextScale = Math.min(
            maxScale,
            Math.max(scale + 0.06, scale * stretch),
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
          refined.distanceKm > request.distanceKm * 1.08 &&
          metrics.distanceError > SCALE_TARGET_DISTANCE_ERROR &&
          scales.length < MAX_SCALE_PASSES &&
          Date.now() < deadlineMs - 6_000
        ) {
          const ratio = request.distanceKm / Math.max(refined.distanceKm, 1);
          const shrink = 1 - (1 - ratio) * 0.7;
          const nextScale = Math.max(0.72, Math.min(scale - 0.05, scale * shrink));
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

        const tooSpurHeavy =
          metrics.spurShare > MAX_SPUR_SHARE || metrics.backtrack > MAX_BACKTRACK;
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

        if (tooSpurHeavy || wrongDirection || tooShortWithVias || tooShort || tooLong) {
          if (quality < bestRejectedScore) {
            bestRejectedScore = quality;
            bestRejected = refined;
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

        if (
          metrics.directionCoverage >= 0.55 &&
          metrics.distanceError <
            maxAcceptableDistanceError(request.distanceKm, false, baseUrban) &&
          metrics.spurShare < 0.06 &&
          refined.distanceKm >= minLoopKm
        ) {
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
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[loopforge] variant failed:", error);
      }
    }
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
    const rejectedDistanceLimit = maxAcceptableDistanceError(
      request.distanceKm,
      true,
      baseUrban,
    );
    if (
      rejectedMetrics.directionCoverage >= 0.38 &&
      rejectedMetrics.distanceError < rejectedDistanceLimit &&
      bestRejected.distanceKm >= minLoopKm &&
      rejectedApproachOverlap <= MAX_APPROACH_OVERLAP_RELAXED &&
      !hasSuspiciousTeleportEdge(bestRejected.coordinates, geoCtx)
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
    const fallbackDistanceLimit = maxAcceptableDistanceError(
      request.distanceKm,
      true,
      baseUrban,
    );
    if (
      fallbackMetrics.directionCoverage >= 0.32 &&
      fallbackMetrics.distanceError < fallbackDistanceLimit &&
      bestFallback.distanceKm >= minLoopKm &&
      fallbackApproachOverlap <= MAX_APPROACH_OVERLAP_RELAXED &&
      !hasSuspiciousTeleportEdge(bestFallback.coordinates, geoCtx)
    ) {
      best = bestFallback;
      usedRelaxedFallback = true;
    }
  }

  if (!best) {
    for (const variant of [0, 1, 2, 3]) {
      if (Date.now() > deadlineMs) break;
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
        const waypoints = buildLoopWaypointsWithVia(
          request.start,
          request.distanceKm,
          request.direction,
          variant,
          1.15,
          shape,
          false,
          jitter,
          viaCoords,
          options?.homeStart ? { homeStart: options.homeStart } : undefined,
          recoveryPrefs,
        );
        const routed = await fetchLoopRouteResilient(fetchRoute, {
          start: request.start,
          bikeType: request.bikeType,
          waypoints,
          rideProfile: request.profile,
          avoidAsphalt: false,
          preferQuietRoutes: false,
          urbanRouting: baseUrban,
          skipGpx: true,
        });
        if (hasSuspiciousTeleportEdge(routed.coordinates, geoCtx)) continue;
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
        if (
          !hasSuspiciousTeleportEdge(refined.coordinates, geoCtx) &&
          refined.coordinates.length >= 4 &&
          refined.distanceKm >= request.distanceKm * 0.45 &&
          refined.distanceKm <=
            request.distanceKm *
              maxLoopShareOfTarget(request.distanceKm, true, baseUrban)
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
    if (
      bestLowOverlap.distanceKm <=
        request.distanceKm *
          maxLoopShareOfTarget(request.distanceKm, true, baseUrban) &&
      !hasSuspiciousTeleportEdge(bestLowOverlap.coordinates, geoCtx)
    ) {
      best = bestLowOverlap;
      usedRelaxedFallback = true;
    }
  }

  if (
    !best &&
    bestFallback &&
    !hasSuspiciousTeleportEdge(bestFallback.coordinates, geoCtx) &&
    bestFallback.coordinates.length >= 4 &&
    bestFallback.distanceKm >= request.distanceKm * 0.35 &&
    bestFallback.distanceKm <=
      request.distanceKm *
        maxLoopShareOfTarget(request.distanceKm, true, baseUrban)
  ) {
    best = bestFallback;
    usedRelaxedFallback = true;
  }

  // Prefer any real routed loop over showing the user an empty error.
  if (!best) {
    const maxShare = maxLoopShareOfTarget(request.distanceKm, true, baseUrban);
    const candidates = [bestRejected, bestFallback, bestLowOverlap].filter(
      (c): c is RoutedLoopResult =>
        !!c &&
        c.coordinates.length >= 4 &&
        c.distanceKm >= request.distanceKm * 0.35 &&
        c.distanceKm <= request.distanceKm * maxShare &&
        !hasSuspiciousTeleportEdge(c.coordinates, geoCtx),
    );
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const ma = loopQualityMetrics(
          a.coordinates,
          request.distanceKm,
          a.distanceKm,
          request.start,
          request.direction,
        );
        const mb = loopQualityMetrics(
          b.coordinates,
          request.distanceKm,
          b.distanceKm,
          request.start,
          request.direction,
        );
        return (
          ma.distanceError +
          ma.backtrack * 2 +
          (1 - ma.directionCoverage) -
          (mb.distanceError + mb.backtrack * 2 + (1 - mb.directionCoverage))
        );
      });
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

  if (!best) {
    const urbanHint = baseUrban
      ? " W aglomeracji spróbuj krótszego dystansu albo startu za miastem."
      : "";
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
        0.45,
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
      !hasSuspiciousTeleportEdge(bestLowOverlap.coordinates, geoCtx)
    ) {
      best = bestLowOverlap;
      finalMetrics = lowOverlapMetrics;
      usedRelaxedFallback = true;
    }
  }

  const minLoopKmFinal = usedRelaxedFallback
    ? request.distanceKm * 0.35
    : minLoopKm;

  if (
    finalMetrics.directionCoverage < minDirectionCoverage ||
    finalMetrics.distanceError > distanceErrorLimit ||
    best.distanceKm < minLoopKmFinal
  ) {
    const maxShare = maxLoopShareOfTarget(request.distanceKm, true, baseUrban);
    // Once BRouter found roads, keep the loop — imperfect beats empty UI,
    // but never return a loop nearly 2× the requested distance.
    if (
      best.coordinates.length >= 4 &&
      best.distanceKm >= request.distanceKm * 0.35 &&
      best.distanceKm <= request.distanceKm * maxShare
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
    } else {
      const urbanHint = baseUrban
        ? " W mieście 50 km bywa trudne — spróbuj 35 km albo start za granicą aglomeracji."
        : "";
      throw new Error(
        best.distanceKm > request.distanceKm * maxShare
          ? `Trasa wyszła za długa (${best.distanceKm.toFixed(1)} km zamiast ~${request.distanceKm} km) — spróbuj innego kierunku lub krótszego dystansu.`
          : hasViaPoints && finalMetrics.distanceError > distanceErrorLimit
            ? `Trasa z punktami przejazdu wyszła za krótka (${best.distanceKm.toFixed(1)} km zamiast ~${request.distanceKm} km) — dodaj punkty bliżej obwodu pętli lub zmniejsz dystans.`
            : `Nie udało się dopasować trasy do dystansu i kierunku (${best.distanceKm.toFixed(1)} km zamiast ~${request.distanceKm} km).${urbanHint}`,
      );
    }
  }

  const finalized = finalizeLoopWithoutSpurs(best, request.start);
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
