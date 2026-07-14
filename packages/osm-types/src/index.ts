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

export {
  RIDE_PROFILE_OPTIONS,
  getRideProfileHint,
  getRideProfileLabel,
  getRideProfileOptions,
  type RideProfileOption,
} from "./ride-profiles";

export {
  getRideProfileLoopPrefs,
  profileSurfaceMismatch,
  type RideProfileLoopPrefs,
} from "./profile-preferences";

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

/** User-chosen must-pass point on the loop (not the home start). */
export interface RouteViaPoint extends LatLng {
  label?: string;
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
  /** Penalize paved surfaces (gravel / MTB). Not a hard ban — asphalt when no alternative. */
  avoidAsphalt?: boolean;
  /** Route a fast approach leg from start to loop entry before generating the loop. */
  approachEnabled?: boolean;
  /** Target approach distance in km (air-line anchor along direction). */
  approachDistanceKm?: number;
  /** Must-pass places on the loop (max 3), validated against loop zone. */
  viaPoints?: RouteViaPoint[];
}

export interface SurfaceBreakdownItem {
  label: string;
  share: number;
  color: string;
}

export interface RouteMetrics {
  distanceKm: number;
  /** Loop portion only — set when approach leg is included. */
  loopDistanceKm?: number;
  /** Outbound approach leg (home → loop entry). */
  approachDistanceKm?: number;
  /** Return approach leg (loop exit → home), usually mirrors outbound. */
  returnApproachKm?: number;
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
    /** Present on styled approach legs in mapGeojson (home ↔ loop entry). */
    leg?: "approach";
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
  avoidAsphalt?: boolean;
  approachEnabled?: boolean;
  /** Configured approach target distance (km). */
  approachDistanceKm?: number;
  loopEntry?: LatLng;
  viaPoints?: RouteViaPoint[];
  rating?: "up" | "down";
  notes?: string;
}

export type RouteGenerationPhase =
  | "planning"
  | "approach"
  | "variants"
  | "routing"
  | "scoring"
  | "refining"
  | "finalizing";

export interface RouteGenerationProgress {
  phase: RouteGenerationPhase;
  message: string;
  detail?: string;
  /** 0–100 */
  progress: number;
  variantIndex?: number;
  variantTotal?: number;
}

export type RouteGenerationStreamEvent =
  | { type: "progress"; progress: RouteGenerationProgress }
  | { type: "complete"; route: StoredRoute }
  | { type: "error"; error: string };
