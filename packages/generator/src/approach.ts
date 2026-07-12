import type {
  GenerateRouteRequest,
  GeneratedRoute,
  LatLng,
  OsmTags,
  RouteMapGeoJson,
  RouteSegmentFeature,
} from "@loopforge/osm-types";
import { buildGpx } from "@loopforge/gpx";
import { scoreRoute } from "@loopforge/scoring";
import { surfaceBreakdownFromSegments } from "@loopforge/routing";
import { prepareCoordinatesForNavigation } from "./prune-spurs";

const APPROACH_COLOR = "#64748b";
const APPROACH_LABEL = "Dojazd";
const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

function destinationPoint(
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

export interface RoutedLeg {
  coordinates: [number, number][];
  distanceKm: number;
  elevationGainM: number;
  segments: { tags: import("@loopforge/osm-types").OsmTags; distanceM: number }[];
  mapGeojson?: RouteMapGeoJson | null;
}

export function loopEntryOffsetM(loopDistanceKm: number): number {
  return Math.round(
    Math.min(18_000, Math.max(4_000, loopDistanceKm * 160)),
  );
}

export function approachTargetOffsetM(
  loopDistanceKm: number,
  approachDistanceKm?: number,
): number {
  if (approachDistanceKm != null && approachDistanceKm > 0) {
    return Math.round(Math.min(40, Math.max(1, approachDistanceKm)) * 1000);
  }
  return loopEntryOffsetM(loopDistanceKm);
}

export function computeLoopEntryTarget(
  start: LatLng,
  direction: GenerateRouteRequest["direction"],
  loopDistanceKm: number,
  approachDistanceKm?: number,
): LatLng {
  const bearing = {
    N: 0,
    NE: 45,
    E: 90,
    SE: 135,
    S: 180,
    SW: 225,
    W: 270,
    NW: 315,
  }[direction];
  return destinationPoint(
    start,
    bearing,
    approachTargetOffsetM(loopDistanceKm, approachDistanceKm),
  );
}

function coordToLatLng(coord: [number, number]): LatLng {
  return { lng: coord[0], lat: coord[1] };
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

function totalDistanceKm(coords: [number, number][]): number {
  const EARTH_RADIUS_M = 6_371_000;
  const haversineM = (a: [number, number], b: [number, number]) => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLng = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
  };

  let meters = 0;
  for (let i = 1; i < coords.length; i++) {
    meters += haversineM(coords[i - 1], coords[i]);
  }
  return meters / 1000;
}

function styleApproachMapGeojson(
  mapGeojson: RouteMapGeoJson | null | undefined,
): RouteMapGeoJson | undefined {
  if (!mapGeojson?.features.length) return undefined;

  const features: RouteSegmentFeature[] = mapGeojson.features.map((feature) => ({
    ...feature,
    properties: {
      ...feature.properties,
      label: APPROACH_LABEL,
      color: APPROACH_COLOR,
      category: "asphalt",
      dash: [2, 2],
    },
  }));

  return { type: "FeatureCollection", features };
}

function mergeMapGeojson(
  approach: RouteMapGeoJson | null | undefined,
  loop: RouteMapGeoJson | null | undefined,
): RouteMapGeoJson | undefined {
  const approachStyled = styleApproachMapGeojson(approach);
  const features = [
    ...(approachStyled?.features ?? []),
    ...(loop?.features ?? []),
  ];
  return features.length > 0 ? { type: "FeatureCollection", features } : undefined;
}

function haversineCoordsM(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function haversineM(a: LatLng, b: LatLng): number {
  return haversineCoordsM([a.lng, a.lat], [b.lng, b.lat]);
}

function pathLengthM(coordinates: [number, number][], from: number, to: number): number {
  let meters = 0;
  const start = Math.max(0, from);
  const end = Math.min(to, coordinates.length - 1);
  for (let i = start; i < end; i++) {
    meters += haversineCoordsM(coordinates[i], coordinates[i + 1]);
  }
  return meters;
}

function coordNear(a: [number, number], b: [number, number], maxM: number): boolean {
  return haversineCoordsM(a, b) <= maxM;
}

/**
 * A closed loop routed back to loop entry creates an out-and-back "spur" at the
 * junction when an approach leg already ends there. Open the loop at the join.
 */
export function openLoopForApproachMerge(
  loopCoordinates: [number, number][],
  entry: [number, number],
): [number, number][] {
  if (loopCoordinates.length < 4) return loopCoordinates;

  const last = loopCoordinates[loopCoordinates.length - 1];
  if (!coordNear(last, entry, 80)) return loopCoordinates;

  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 0; i < loopCoordinates.length; i++) {
    const d = haversineM(
      { lng: loopCoordinates[i][0], lat: loopCoordinates[i][1] },
      { lng: entry[0], lat: entry[1] },
    );
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist < 500) return loopCoordinates;

  let closureStart = loopCoordinates.length;
  for (let i = loopCoordinates.length - 2; i > maxIdx; i--) {
    const here = { lng: loopCoordinates[i][0], lat: loopCoordinates[i][1] };
    const next = {
      lng: loopCoordinates[i + 1][0],
      lat: loopCoordinates[i + 1][1],
    };
    const entryPt = { lng: entry[0], lat: entry[1] };
    const dHere = haversineM(here, entryPt);
    const dNext = haversineM(next, entryPt);
    if (dNext < dHere - 20 && dHere > 120) {
      closureStart = i + 1;
      break;
    }
  }

  if (closureStart >= loopCoordinates.length) {
    return coordNear(loopCoordinates[0], last, 30)
      ? loopCoordinates.slice(0, -1)
      : loopCoordinates;
  }

  const returnLegM = pathLengthM(
    loopCoordinates,
    Math.max(0, closureStart - 1),
    loopCoordinates.length - 1,
  );
  if (returnLegM < 150) {
    return loopCoordinates.slice(0, -1);
  }

  return loopCoordinates.slice(0, closureStart);
}

export function mergeApproachAndLoop(
  request: GenerateRouteRequest,
  userStart: LatLng,
  loopEntry: LatLng,
  approach: RoutedLeg,
  loop: GeneratedRoute,
  loopSegments: { tags: OsmTags; distanceM: number }[],
): GeneratedRoute {
  const entryCoord: [number, number] = [loopEntry.lng, loopEntry.lat];
  const loopNavCoordinates = prepareCoordinatesForNavigation(
    loop.geojson.geometry.coordinates,
  );
  const openedLoop = openLoopForApproachMerge(loopNavCoordinates, entryCoord);
  const mergedCoordinates: [number, number][] = [];
  appendCoordinates(mergedCoordinates, approach.coordinates);
  appendCoordinates(mergedCoordinates, openedLoop);

  const approachKm = approach.distanceKm;
  const loopKm = loop.metrics.loopDistanceKm ?? loop.metrics.distanceKm;
  const totalKm =
    mergedCoordinates.length > 1
      ? totalDistanceKm(mergedCoordinates)
      : approachKm + loopKm;

  const score = scoreRoute(loopSegments, request.bikeType);
  const surfaceBreakdown =
    loopSegments.length > 0
      ? surfaceBreakdownFromSegments(loopSegments)
      : loop.metrics.surfaceBreakdown;

  const name = `Loopforge ${request.bikeType} ${Math.round(loopKm)}km + dojazd`;

  return {
    ...loop,
    geojson: {
      type: "Feature",
      properties: {
        ...loop.geojson.properties,
        approachEnabled: true,
        loopEntry,
        score,
      },
      geometry: {
        type: "LineString",
        coordinates: mergedCoordinates,
      },
    },
    mapGeojson: mergeMapGeojson(approach.mapGeojson, loop.mapGeojson),
    metrics: {
      distanceKm: totalKm,
      loopDistanceKm: loopKm,
      approachDistanceKm: approachKm,
      elevationGainM: approach.elevationGainM + loop.metrics.elevationGainM,
      surfaceBreakdown,
      score,
    },
    gpx: buildGpx(name, mergedCoordinates, userStart),
  };
}

export function loopEntryFromApproach(approach: RoutedLeg): LatLng {
  const last = approach.coordinates.at(-1);
  return last ? coordToLatLng(last) : { lat: 0, lng: 0 };
}
