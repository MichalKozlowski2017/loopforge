export type BikeType = "road" | "gravel" | "mtb" | "general";

export type Direction =
  | "N"
  | "NE"
  | "E"
  | "SE"
  | "S"
  | "SW"
  | "W"
  | "NW";

export type RideProfile = "flow" | "technical" | "fast";

import type { SurfaceCategory } from "./surface-style";
export type { SurfaceCategory, SurfaceStyle } from "./surface-style";
export {
  getSurfaceStyle,
  parseOsmTagString,
  colorForBreakdownLabel,
  SURFACE_LEGEND,
} from "./surface-style";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface OsmTags {
  [key: string]: string | undefined;
  highway?: string;
  surface?: string;
  route?: string;
  tracktype?: string;
  "mtb:scale"?: string;
}

export interface RouteSegment {
  coordinates: [number, number][];
  tags: OsmTags;
  distanceM: number;
}

export interface GenerateRouteRequest {
  start: LatLng;
  bikeType: BikeType;
  distanceKm: number;
  direction: Direction;
  profile?: RideProfile;
}

export interface SurfaceBreakdownItem {
  label: string;
  share: number;
  color: string;
}

export interface RouteMetrics {
  distanceKm: number;
  elevationGainM: number;
  surfaceBreakdown: SurfaceBreakdownItem[];
  score: number;
}

export interface LineStringGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export interface RouteFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: LineStringGeometry;
}

export interface RouteSegmentFeature {
  type: "Feature";
  properties: {
    surface: string;
    label: string;
    category: SurfaceCategory;
    color: string;
    dash: number[];
    highway?: string;
  };
  geometry: LineStringGeometry;
}

export interface RouteMapGeoJson {
  type: "FeatureCollection";
  features: RouteSegmentFeature[];
}

export interface GeneratedRoute {
  id: string;
  geojson: RouteFeature;
  mapGeojson?: RouteMapGeoJson;
  metrics: RouteMetrics;
  gpx: string;
  createdAt: string;
}

export interface StoredRoute extends GeneratedRoute {
  bikeType: BikeType;
  direction: Direction;
  start: LatLng;
  profile?: RideProfile;
  rating?: "up" | "down";
  notes?: string;
}
