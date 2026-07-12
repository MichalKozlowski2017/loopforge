import type {
  GenerateRouteRequest,
  GeneratedRoute,
  LatLng,
  OsmTags,
  RouteGenerationProgress,
} from "@loopforge/osm-types";
import { getSurfaceStyle } from "@loopforge/osm-types";
import {
  fetchRouteThroughWaypoints as fetchBrouterRoute,
  fetchRouteBetweenPoints as fetchBrouterBetween,
  getBrouterConfig,
} from "@loopforge/brouter";
import {
  fetchRouteThroughWaypoints as fetchPgRoute,
  fetchRouteBetweenPoints as fetchPgBetween,
  isRoutingReady,
  surfaceBreakdownFromSegments,
} from "@loopforge/routing";
import { buildGpx } from "@loopforge/gpx";
import { scoreRoute } from "@loopforge/scoring";
import {
  buildLoopWaypoints,
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
  computeLoopEntryTarget,
  loopEntryOffsetM,
  loopEntryFromApproach,
  mergeApproachAndLoop,
  type RoutedLeg,
} from "./approach";

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
  const actualKm =
    navCoordinates.length > 1 ? totalDistanceKm(navCoordinates) : distanceKm;
  const score = scoreRoute(options.segments, bikeType);
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
    mapGeojson: options.mapGeojson,
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

const MIN_PRUNE_REMOVED_M = 8;
const MAX_SPUR_SHARE = 0.05;
const MAX_BACKTRACK = 0.06;

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

function applySpurRefinement(
  routed: RoutedLoopResult,
  targetDistanceKm: number,
  start: LatLng,
  direction: GenerateRouteRequest["direction"],
  shape: LoopShape,
  avoidAsphalt = false,
): {
  refined: RoutedLoopResult;
  metrics: ReturnType<typeof loopQualityMetrics>;
  quality: number;
  pruned: boolean;
} {
  const pruned = pruneDeadEndSpurs(routed.coordinates);
  const usePruned =
    pruned.removedM >= MIN_PRUNE_REMOVED_M && pruned.coordinates.length >= 4;
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

  const metrics = loopQualityMetrics(
    coordinates,
    targetDistanceKm,
    refined.distanceKm,
    start,
    direction,
  );
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
    },
  );

  return { refined, metrics, quality, pruned: usePruned };
}

async function generateRouteWithEngine(
  request: GenerateRouteRequest,
  fetchRoute: (params: {
    start: LatLng;
    bikeType: GenerateRouteRequest["bikeType"];
    waypoints: LatLng[];
    rideProfile?: GenerateRouteRequest["profile"];
    avoidAsphalt?: boolean;
    skipGpx: boolean;
  }) => Promise<RoutedLoopResult>,
  options?: GenerateRouteOptions,
): Promise<{
  route: GeneratedRoute;
  loopSegments: { tags: OsmTags; distanceM: number }[];
}> {
  const variants = 5;
  const jitter = createGenerationJitter(variants);
  const deadlineMs = Date.now() + 95_000;
  let best: RoutedLoopResult | null = null;
  let bestScore = Infinity;
  let bestRejected: RoutedLoopResult | null = null;
  let bestRejectedScore = Infinity;
  let bestFallback: RoutedLoopResult | null = null;
  let bestFallbackScore = Infinity;
  let usedRelaxedFallback = false;
  let attempt = 0;
  const maxAttemptsEstimate = variants * 2;
  const { onProgress } = options ?? {};

  reportProgress(onProgress, {
    phase: "planning",
    message: "Planuję kształt pętli",
    detail: `${request.distanceKm} km w kierunku ${DIRECTION_LABEL_PL[request.direction]}`,
    progress: 6,
  });

  reportProgress(onProgress, {
    phase: "variants",
    message: "Losuję warianty",
    detail: "Każde generowanie daje inną trasę",
    progress: 12,
  });

  for (const variant of jitter.variantOrder) {
    if (Date.now() > deadlineMs && best) break;

    try {
      const scales: number[] = [1.0];
      let variantDone = false;

      for (let si = 0; si < scales.length; si++) {
        if (Date.now() > deadlineMs && best) break;

        const scale = scales[si];
        const shape = loopShapeForVariant(request.distanceKm, variant);
        const shapeLabel = shape === "arc" ? "łuk" : "podłużna";
        attempt += 1;
        const routingProgress = Math.min(
          85,
          14 + (attempt / maxAttemptsEstimate) * 68,
        );

        reportProgress(onProgress, {
          phase: "routing",
          message: "BRouter liczy trasę",
          detail: `Wariant ${variant + 1}/${variants}, kształt ${shapeLabel}${
            si > 0 ? ", ponowna skala" : ""
          }`,
          progress: routingProgress,
          variantIndex: variant + 1,
          variantTotal: variants,
        });

        const waypoints = buildLoopWaypoints(
          request.start,
          request.distanceKm,
          request.direction,
          variant,
          scale,
          shape,
          request.avoidAsphalt,
          jitter,
        );
        const routed = await fetchRoute({
          start: request.start,
          bikeType: request.bikeType,
          waypoints,
          rideProfile: request.profile,
          avoidAsphalt: request.avoidAsphalt,
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
        );

        reportProgress(onProgress, {
          phase: "scoring",
          message: "Porównuję warianty",
          detail: `${refined.distanceKm.toFixed(1)} km — nawierzchnia, kierunek, jakość pętli`,
          progress: Math.min(88, routingProgress + 3),
          variantIndex: variant + 1,
          variantTotal: variants,
        });

        if (quality < bestFallbackScore) {
          bestFallbackScore = quality;
          bestFallback = refined;
        }

        // One follow-up scale if distance is off (not four scales every time).
        if (
          si === 0 &&
          scales.length === 1 &&
          metrics.distanceError > 0.05 &&
          Date.now() < deadlineMs - 8_000
        ) {
          reportProgress(onProgress, {
            phase: "refining",
            message: "Dopasowuję dystans",
            detail: `Cel ~${request.distanceKm} km, teraz ${refined.distanceKm.toFixed(1)} km`,
            progress: Math.min(90, routingProgress + 5),
          });

          const ratio = request.distanceKm / Math.max(refined.distanceKm, 1);
          const adjusted =
            ratio > 1
              ? 1 + (ratio - 1) * (request.avoidAsphalt ? 0.38 : 0.98)
              : ratio * 0.98;
          const maxScale = request.avoidAsphalt
            ? Math.min(1.28, 1.08 + request.distanceKm / 400)
            : 1.35;
          scales.push(Math.min(maxScale, Math.max(0.72, adjusted)));
        }

        const tooSpurHeavy =
          metrics.spurShare > MAX_SPUR_SHARE || metrics.backtrack > MAX_BACKTRACK;
        const wrongDirection = metrics.directionCoverage < 0.38;

        if (tooSpurHeavy || wrongDirection) {
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
          }
        }

        if (
          isGoodLoopQuality(
            refined.coordinates,
            request.distanceKm,
            refined.distanceKm,
            request.start,
            request.direction,
          )
        ) {
          variantDone = true;
          break;
        }

        if (
          metrics.directionCoverage >= 0.55 &&
          metrics.distanceError < 0.16 &&
          metrics.spurShare < 0.06
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
        )
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
    if (
      rejectedMetrics.directionCoverage >= 0.38 &&
      rejectedMetrics.distanceError < 0.45
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
    if (
      fallbackMetrics.directionCoverage >= 0.32 &&
      fallbackMetrics.distanceError < 0.52
    ) {
      best = bestFallback;
      usedRelaxedFallback = true;
    }
  }

  if (!best) {
    for (const variant of [0, 1, 2, 3]) {
      if (Date.now() > deadlineMs) break;
      try {
        const shape = loopShapeForVariant(request.distanceKm, variant);
        const waypoints = buildLoopWaypoints(
          request.start,
          request.distanceKm,
          request.direction,
          variant,
          1.0,
          shape,
          request.avoidAsphalt,
          jitter,
        );
        const routed = await fetchRoute({
          start: request.start,
          bikeType: request.bikeType,
          waypoints,
          rideProfile: request.profile,
          avoidAsphalt: request.avoidAsphalt,
          skipGpx: true,
        });
        const { refined, metrics } = applySpurRefinement(
          routed,
          request.distanceKm,
          request.start,
          request.direction,
          shape,
          request.avoidAsphalt,
        );
        if (
          metrics.directionCoverage >= 0.3 &&
          metrics.distanceError < 0.55 &&
          refined.coordinates.length >= 4
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

  if (!best) {
    throw new Error(
      "Nie udało się wygenerować trasy — spróbuj innego kierunku, krótszego dystansu lub wyłącz „unikaj asfaltu”.",
    );
  }

  reportProgress(onProgress, {
    phase: "finalizing",
    message: "Spinam GPX",
    detail: "Przycinanie dead-endów i eksport",
    progress: 94,
  });

  const finalMetrics = loopQualityMetrics(
    best.coordinates,
    request.distanceKm,
    best.distanceKm,
    request.start,
    request.direction,
  );
  const maxDistanceError = request.avoidAsphalt
    ? Math.min(0.48, 0.3 + request.distanceKm / 500)
    : 0.38;
  const minDirectionCoverage = usedRelaxedFallback ? 0.3 : 0.42;
  const distanceErrorLimit = usedRelaxedFallback
    ? Math.min(0.58, maxDistanceError + 0.14)
    : maxDistanceError;

  if (
    finalMetrics.directionCoverage < minDirectionCoverage ||
    finalMetrics.distanceError > distanceErrorLimit
  ) {
    throw new Error(
      "Nie udało się dopasować trasy do dystansu i kierunku — spróbuj innego kierunku lub dystansu",
    );
  }

  return {
    route: buildGeneratedRoute(request, best.coordinates, {
      placeholder: false,
      elevationGainM: best.elevationGainM,
      segments: best.segments,
      mapGeojson: best.mapGeojson ?? undefined,
    }),
    loopSegments: best.segments,
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
    message: "Brak backendu routingu",
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
    message: "Spinam GPX",
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

async function fetchApproachLeg(
  from: LatLng,
  to: LatLng,
  bikeType: GenerateRouteRequest["bikeType"],
): Promise<RoutedLeg> {
  const preference = routingEnginePreference();

  if (preference !== "brouter") {
    const pgReady = await isRoutingReady();
    if (pgReady) {
      const routed = await fetchPgBetween(
        { from, to, bikeType, skipGpx: true },
      );
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
    const routed = await fetchBrouterBetween(brouterConfig, {
      from,
      to,
      bikeType,
      skipGpx: true,
      rideProfile: "fast",
      avoidAsphalt: false,
    });
    return {
      coordinates: routed.coordinates,
      distanceKm: routed.distanceKm,
      elevationGainM: routed.elevationGainM,
      segments: routed.segments,
      mapGeojson: routed.mapGeojson,
    };
  }

  const coordinates = [
    ...lineCoordinates(from, to),
  ] as [number, number][];
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
    message: "Liczenie dojazdu do pętli",
    detail: `~${approachTargetKm} km w kierunku ${DIRECTION_LABEL_PL[request.direction]}`,
    progress: 8,
  });

  const approach = await fetchApproachLeg(
    userStart,
    entryTarget,
    request.bikeType,
  );
  const loopEntry = loopEntryFromApproach(approach);

  reportProgress(onProgress, {
    phase: "approach",
    message: "Dojazd gotowy",
    detail: `${approach.distanceKm.toFixed(1)} km — start pętli na mapie`,
    progress: 14,
  });

  const loopRequest: GenerateRouteRequest = {
    ...request,
    start: loopEntry,
    approachEnabled: false,
  };

  const { route: loop, loopSegments } = await generateLoopRoute(
    loopRequest,
    options,
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
export async function generateRoute(
  request: GenerateRouteRequest,
  options?: GenerateRouteOptions,
): Promise<GeneratedRoute> {
  if (request.approachEnabled) {
    return generateRouteWithApproach(request, options);
  }
  return (await generateLoopRoute(request, options)).route;
}
