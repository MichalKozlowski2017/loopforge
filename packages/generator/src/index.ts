import type {
  Direction,
  GenerateRouteRequest,
  GeneratedRoute,
  LatLng,
} from "@loopforge/osm-types";
import { buildGpx } from "@loopforge/gpx";
import { scoreRoute } from "@loopforge/scoring";

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

function buildLoopCoordinates(
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

/**
 * Phase 0 placeholder generator — geometric loop until BRouter is wired.
 * Produces a rough rectangular loop in the chosen direction for map preview.
 */
export function generateRoute(request: GenerateRouteRequest): GeneratedRoute {
  const { start, bikeType, distanceKm, direction } = request;
  const coordinates = buildLoopCoordinates(start, direction, distanceKm);
  const actualKm = totalDistanceKm(coordinates);

  const mockSegments = [
    { tags: { highway: "track", surface: "gravel" }, distanceM: actualKm * 500 },
    { tags: { highway: "cycleway", surface: "compacted" }, distanceM: actualKm * 500 },
  ];

  const score = scoreRoute(mockSegments, bikeType);
  const id = crypto.randomUUID();
  const name = `Loopforge ${bikeType} ${Math.round(actualKm)}km`;

  return {
    id,
    geojson: {
      type: "Feature",
      properties: {
        bikeType,
        direction,
        score,
        placeholder: true,
      },
      geometry: {
        type: "LineString",
        coordinates,
      },
    },
    metrics: {
      distanceKm: actualKm,
      elevationGainM: Math.round(actualKm * 12),
      surfaceBreakdown: {
        gravel: 0.55,
        compacted: 0.3,
        asphalt: 0.15,
      },
      score,
    },
    gpx: buildGpx(name, coordinates, start),
    createdAt: new Date().toISOString(),
  };
}
