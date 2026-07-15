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
} from "./prune-spurs";
import {
  maxAcceptableDistanceError,
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
    gpx?: string;
  },
): GeneratedRoute {
  const { start, bikeType, direction, distanceKm } = request;
  const navCoordinates = prepareCoordinatesForNavigation(coordinates);
  const syncedMapGeojson = options.mapGeojson
    ? pruneMapGeoJson(options.mapGeojson, navCoordinates)
    : null;
  const actualKm =
    navCoordinates.length > 1 ? totalDistanceKm(navCoordinates) : distanceKm;
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
        coordinates: navCoordinates,
      },
    },
    mapGeojson: syncedMapGeojson ?? options.mapGeojson,
    metrics: {
      distanceKm: actualKm,
      loopDistanceKm: actualKm,
      elevationGainM: options.elevationGainM,
      surfaceBreakdown,
      score,
    },
    gpx: options.gpx ?? buildGpx(name, navCoordinates, start),
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
): {
  refined: RoutedLoopResult;
  metrics: ReturnType<typeof loopQualityMetrics> & { approachOverlap: number };
  quality: number;
  pruned: boolean;
} {
  const pruned = pruneDeadEndSpurs(routed.coordinates);
  const usePruned =
    pruned.removedRanges.length > 0 &&
    pruned.removedM >= MIN_PRUNE_REMOVED_M &&
    pruned.coordinates.length >= 4;
  const coordinates = usePruned ? pruned.coordinates : routed.coordinates;
  const mapGeojson = pruneMapGeoJson(
    routed.mapGeojson ?? null,
    coordinates,
  );

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
      pavedShare: pavedShareFromSegments(routed.segments),
      offroadShare: offroadShareFromSegments(routed.segments),
      approachOverlap,
      viaPointsMode,
      profilePrefs,
    },
  );

  return { refined, metrics, quality, pruned: usePruned };
}

function finalizeLoopWithoutSpurs(best: RoutedLoopResult): RoutedLoopResult {
  const pruned = pruneDeadEndSpurs(best.coordinates);
  if (
    pruned.removedRanges.length === 0 ||
    pruned.removedM < MIN_PRUNE_REMOVED_M ||
    pruned.coordinates.length < 4
  ) {
    return best;
  }

  const coordinates = pruned.coordinates;
  const mapGeojson =
    pruneMapGeoJson(best.mapGeojson ?? null, coordinates) ??
    best.mapGeojson ??
    undefined;

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
    request.distanceKm * minLoopShareOfTarget(request.distanceKm);
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
        const routed = await fetchRoute({
          start: request.start,
          bikeType: request.bikeType,
          waypoints,
          rideProfile: request.profile,
          avoidAsphalt: request.avoidAsphalt,
          urbanRouting: baseUrban || variantUrbanEscalated,
          skipGpx: true,
        });

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
        );

        if (shouldEscalateUrbanTuning(request.distanceKm, refined.distanceKm)) {
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

        const maxDistanceError = maxAcceptableDistanceError(
          request.distanceKm,
          false,
        );
        const tooShort =
          refined.distanceKm < minLoopKm ||
          metrics.distanceError > maxDistanceError;

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

        if (tooSpurHeavy || wrongDirection || tooShortWithVias || tooShort) {
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
          ) &&
          refined.distanceKm >= minLoopKm
        ) {
          variantDone = true;
          break;
        }

        if (
          metrics.directionCoverage >= 0.55 &&
          metrics.distanceError <
            maxAcceptableDistanceError(request.distanceKm, false) &&
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
        ).distanceError <= maxAcceptableDistanceError(request.distanceKm, false)
      ) {
        break;
      }
    } catch {
      // try next variant
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
    );
    if (
      rejectedMetrics.directionCoverage >= 0.38 &&
      rejectedMetrics.distanceError < rejectedDistanceLimit &&
      bestRejected.distanceKm >= minLoopKm &&
      rejectedApproachOverlap <= MAX_APPROACH_OVERLAP_RELAXED
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
    );
    if (
      fallbackMetrics.directionCoverage >= 0.32 &&
      fallbackMetrics.distanceError < fallbackDistanceLimit &&
      bestFallback.distanceKm >= minLoopKm &&
      fallbackApproachOverlap <= MAX_APPROACH_OVERLAP_RELAXED
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
          urbanWaypointAdjustments(request.distanceKm, true),
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
          request.avoidAsphalt ?? false,
          jitter,
          viaCoords,
          options?.homeStart ? { homeStart: options.homeStart } : undefined,
          recoveryPrefs,
        );
        const routed = await fetchRoute({
          start: request.start,
          bikeType: request.bikeType,
          waypoints,
          rideProfile: request.profile,
          avoidAsphalt: request.avoidAsphalt,
          urbanRouting: true,
          skipGpx: true,
        });
        const { refined, metrics } = applySpurRefinement(
          routed,
          request.distanceKm,
          request.start,
          request.direction,
          shape,
          request.avoidAsphalt,
          options?.approachCoordinates,
          (request.viaPoints?.length ?? 0) > 0,
          recoveryPrefs,
        );
        const recoveryApproachOverlap = options?.approachCoordinates
          ? approachOverlapShare(
              refined.coordinates,
              options.approachCoordinates,
            )
          : 0;
        if (
          metrics.directionCoverage >= 0.3 &&
          metrics.distanceError <
            maxAcceptableDistanceError(request.distanceKm, true) &&
          refined.distanceKm >= minLoopKm &&
          refined.coordinates.length >= 4 &&
          recoveryApproachOverlap <= MAX_APPROACH_OVERLAP_RELAXED
        ) {
          best = refined;
          usedRelaxedFallback = true;
          break;
        }
      } catch {
        // try next recovery variant
      }
    }
  }

  if (!best && bestLowOverlap) {
    best = bestLowOverlap;
    usedRelaxedFallback = true;
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
    detail: "Ostatnie szlify przed mapą",
    progress: 94,
  });

  const hasViaPoints = (request.viaPoints?.length ?? 0) > 0;
  const approachMode = options?.approachCoordinates != null;
  const minDirectionCoverage = usedRelaxedFallback
    ? 0.3
    : approachMode
      ? 0.36
      : 0.42;
  const distanceErrorLimit = maxAcceptableDistanceError(
    request.distanceKm,
    usedRelaxedFallback,
  );

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
      lowOverlapMetrics.distanceError <= distanceErrorLimit
    ) {
      best = bestLowOverlap;
      finalMetrics = lowOverlapMetrics;
      usedRelaxedFallback = true;
    }
  }

  if (
    finalMetrics.directionCoverage < minDirectionCoverage ||
    finalMetrics.distanceError > distanceErrorLimit ||
    best.distanceKm < minLoopKm
  ) {
    const urbanHint = baseUrban
      ? " W mieście 50 km bywa trudne — spróbuj 35 km albo start za granicą aglomeracji."
      : "";
    throw new Error(
      hasViaPoints && finalMetrics.distanceError > distanceErrorLimit
        ? `Trasa z punktami przejazdu wyszła za krótka (${best.distanceKm.toFixed(1)} km zamiast ~${request.distanceKm} km) — dodaj punkty bliżej obwodu pętli lub zmniejsz dystans.`
        : `Nie udało się dopasować trasy do dystansu i kierunku (${best.distanceKm.toFixed(1)} km zamiast ~${request.distanceKm} km).${urbanHint}`,
    );
  }

  const finalized = finalizeLoopWithoutSpurs(best);
  const finalLoopMetrics = loopQualityMetrics(
    finalized.coordinates,
    request.distanceKm,
    finalized.distanceKm,
    request.start,
    request.direction,
  );
  if (
    finalLoopMetrics.spurShare > MAX_SPUR_SHARE * 1.6 ||
    finalLoopMetrics.backtrack > MAX_BACKTRACK * 1.5
  ) {
    throw new Error(
      "Trasa miałaby zbyt dużo cofania — spróbuj innego kierunku, krótszego dystansu lub podprofilu Balans.",
    );
  }

  return {
    route: buildGeneratedRoute(request, finalized.coordinates, {
      placeholder: false,
      elevationGainM: finalized.elevationGainM,
      segments: finalized.segments,
      mapGeojson: finalized.mapGeojson ?? undefined,
    }),
    loopSegments: finalized.segments,
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
  const approachSanitized = pruneApproachLeg(approachRaw);
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
