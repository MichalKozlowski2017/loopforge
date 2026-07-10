import type {
  Direction,
  GenerateRouteRequest,
  GeneratedRoute,
  LatLng,
} from "@loopforge/osm-types";
import {
  fetchRouteThroughWaypoints,
  getBrouterConfig,
  surfaceBreakdownFromSegments,
} from "@loopforge/brouter";
import { buildGpx } from "@loopforge/gpx";
import { scoreRoute } from "@loopforge/scoring";
import {
  backtrackRatio,
  buildLoopWaypoints,
  overlapRatio,
  scoreLoopQuality,
} from "./loop-waypoints";

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

const EARTH_RADIUS_M = 6_371_000;

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
  direction: Direction,
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

async function generateRouteWithBrouter(
  request: GenerateRouteRequest,
): Promise<GeneratedRoute> {
  const config = getBrouterConfig();
  if (!config) {
    throw new Error("BRouter is not configured");
  }

  const variants = 8;
  let best: Awaited<ReturnType<typeof fetchRouteThroughWaypoints>> | null = null;
  let bestScore = Infinity;

  for (let variant = 0; variant < variants; variant++) {
    try {
      const waypoints = buildLoopWaypoints(
        request.start,
        request.distanceKm,
        request.direction,
        variant,
      );
      const routed = await fetchRouteThroughWaypoints(config, {
        start: request.start,
        bikeType: request.bikeType,
        waypoints,
      });

      const quality = scoreLoopQuality(
        routed.coordinates,
        request.distanceKm,
        routed.distanceKm,
      );

      if (quality < bestScore) {
        bestScore = quality;
        best = routed;
      }

      // Good enough: low overlap and minimal backtracking
      if (
        overlapRatio(routed.coordinates) < 0.08 &&
        backtrackRatio(routed.coordinates) < 0.05 &&
        Math.abs(routed.distanceKm - request.distanceKm) / request.distanceKm <
          0.2
      ) {
        break;
      }
    } catch {
      // try next variant
    }
  }

  if (!best) {
    throw new Error("Could not generate loop through waypoints");
  }

  return buildGeneratedRoute(request, best.coordinates, {
    placeholder: false,
    elevationGainM: best.elevationGainM,
    segments: best.segments,
    mapGeojson: best.mapGeojson ?? undefined,
    gpx: best.gpx || undefined,
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

export async function generateRoute(
  request: GenerateRouteRequest,
): Promise<GeneratedRoute> {
  if (getBrouterConfig()) {
    try {
      return await generateRouteWithBrouter(request);
    } catch (error) {
      console.error("[loopforge] BRouter failed, using placeholder:", error);
    }
  }

  return generatePlaceholderRoute(request);
}
