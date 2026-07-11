import type {
  GenerateRouteRequest,
  GeneratedRoute,
  LatLng,
} from "@loopforge/osm-types";
import {
  fetchRouteThroughWaypoints as fetchBrouterRoute,
  getBrouterConfig,
} from "@loopforge/brouter";
import {
  fetchRouteThroughWaypoints as fetchPgRoute,
  isRoutingReady,
  surfaceBreakdownFromSegments,
} from "@loopforge/routing";
import { buildGpx } from "@loopforge/gpx";
import { scoreRoute } from "@loopforge/scoring";
import {
  buildLoopWaypoints,
  isGoodLoopQuality,
  loopQualityMetrics,
  scoreLoopQuality,
} from "./loop-waypoints";
import { pruneDeadEndSpurs } from "./prune-spurs";

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
  const actualKm =
    coordinates.length > 1 ? totalDistanceKm(coordinates) : distanceKm;
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
        coordinates,
      },
    },
    mapGeojson: options.mapGeojson,
    metrics: {
      distanceKm: actualKm,
      elevationGainM: options.elevationGainM,
      surfaceBreakdown,
      score,
    },
    gpx: options.gpx ?? buildGpx(name, coordinates, start),
    createdAt: new Date().toISOString(),
  };
}

async function generateRouteWithEngine(
  request: GenerateRouteRequest,
  fetchRoute: (params: {
    start: LatLng;
    bikeType: GenerateRouteRequest["bikeType"];
    waypoints: LatLng[];
    rideProfile?: GenerateRouteRequest["profile"];
    skipGpx: boolean;
  }) => Promise<RoutedLoopResult>,
): Promise<GeneratedRoute> {
  const variants = 8;
  const deadlineMs = Date.now() + 50_000;
  let best: RoutedLoopResult | null = null;
  let bestScore = Infinity;
  let bestRejected: RoutedLoopResult | null = null;
  let bestRejectedScore = Infinity;

  const refineRouted = (routed: RoutedLoopResult) => {
    const pruned = pruneDeadEndSpurs(routed.coordinates);
    const scoreCoords =
      pruned.removedM >= 25 ? pruned.coordinates : routed.coordinates;

    return {
      routed,
      quality: scoreLoopQuality(
        scoreCoords,
        request.distanceKm,
        routed.distanceKm,
      ),
      metrics: loopQualityMetrics(
        scoreCoords,
        request.distanceKm,
        routed.distanceKm,
      ),
      hasFerry: routed.segments.some((segment) => segment.tags.route === "ferry"),
    };
  };

  for (let variant = 0; variant < variants; variant++) {
    if (Date.now() > deadlineMs && best) break;

    try {
      const waypoints = buildLoopWaypoints(
        request.start,
        request.distanceKm,
        request.direction,
        variant,
      );
      const { routed, quality, metrics, hasFerry } = refineRouted(
        await fetchRoute({
          start: request.start,
          bikeType: request.bikeType,
          waypoints,
          rideProfile: request.profile,
          skipGpx: true,
        }),
      );

      if (hasFerry) continue;

      const tooSpurHeavy =
        metrics.spurShare > 0.08 || metrics.backtrack > 0.08;

      if (tooSpurHeavy) {
        if (quality < bestRejectedScore) {
          bestRejectedScore = quality;
          bestRejected = routed;
        }
        continue;
      }

      if (quality < bestScore) {
        bestScore = quality;
        best = routed;
      }

      if (
        isGoodLoopQuality(
          routed.coordinates,
          request.distanceKm,
          routed.distanceKm,
        )
      ) {
        break;
      }
    } catch {
      // try next variant
    }
  }

  if (!best && bestRejected) {
    best = bestRejected;
  }

  if (!best) {
    throw new Error("Could not generate loop through waypoints");
  }

  return buildGeneratedRoute(request, best.coordinates, {
    placeholder: false,
    elevationGainM: best.elevationGainM,
    segments: best.segments,
    mapGeojson: best.mapGeojson ?? undefined,
  });
}

function generatePlaceholderRoute(request: GenerateRouteRequest): GeneratedRoute {
  const coordinates = buildPlaceholderLoop(
    request.start,
    request.direction,
    request.distanceKm,
  );
  const actualKm = totalDistanceKm(coordinates);

  return buildGeneratedRoute(request, coordinates, {
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
  });
}

function routingEnginePreference(): "auto" | "pgrouting" | "brouter" {
  const value = process.env.ROUTING_ENGINE?.trim().toLowerCase();
  if (value === "pgrouting" || value === "brouter") return value;
  return "auto";
}

export async function generateRoute(
  request: GenerateRouteRequest,
): Promise<GeneratedRoute> {
  const preference = routingEnginePreference();

  if (preference !== "brouter") {
    const pgReady = await isRoutingReady();
    if (pgReady) {
      return generateRouteWithEngine(request, async (params) => {
        const routed = await fetchPgRoute(params);
        return {
          coordinates: routed.coordinates,
          distanceKm: routed.distanceKm,
          elevationGainM: routed.elevationGainM,
          segments: routed.segments,
          mapGeojson: routed.mapGeojson,
          gpx: routed.gpx,
        };
      });
    }
    if (preference === "pgrouting") {
      throw new Error(
        "pgRouting is not ready — run supabase db push and pnpm import:osm",
      );
    }
  }

  const brouterConfig = getBrouterConfig();
  if (brouterConfig) {
    return generateRouteWithEngine(request, async (params) => {
      const routed = await fetchBrouterRoute(brouterConfig, params);
      return {
        coordinates: routed.coordinates,
        distanceKm: routed.distanceKm,
        elevationGainM: routed.elevationGainM,
        segments: routed.segments,
        mapGeojson: routed.mapGeojson ?? undefined,
        gpx: routed.gpx,
      };
    });
  }

  console.warn("[loopforge] No routing backend — using geometric placeholder");
  return generatePlaceholderRoute(request);
}
