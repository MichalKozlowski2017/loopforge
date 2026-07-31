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

/** How the loop is planned: classic distance+direction, or must-pass pins. */
export type PlanningMode = "loop" | "waypoints";

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
  /** Default `loop`. `waypoints` = closed route through user pins (viaPoints). */
  planningMode?: PlanningMode;
  profile?: RideProfile;
  /** Penalize paved surfaces (gravel / MTB). Not a hard ban — asphalt when no alternative. */
  avoidAsphalt?: boolean;
  /** Prefer cycleways and low-traffic streets over busy car roads when possible. */
  preferQuietRoutes?: boolean;
  /** Route a fast approach leg from start to loop entry before generating the loop. */
  approachEnabled?: boolean;
  /** Target approach distance in km (air-line anchor along direction). */
  approachDistanceKm?: number;
  /**
   * Must-pass places on the loop.
   * Loop mode: optional (max 3), validated against distance/direction zone.
   * Waypoints mode: required (1–5), order is ride order.
   */
  viaPoints?: RouteViaPoint[];
  /**
   * How many distinct loop alternatives to return (loop mode only).
   * Default 1. Ignored for waypoints and when approach is enabled.
   */
  loopVariantCount?: 1 | 2 | 3;
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

export type RouteGenerationMode = "normal" | "relaxed" | "fallback";

/** When the generator ships an imperfect loop instead of failing. */
export interface RouteGenerationQuality {
  mode: RouteGenerationMode;
  /** Polish copy for UI — why the route differs from the request. */
  warnings: string[];
  requestedDistanceKm?: number;
  actualDistanceKm?: number;
}

export interface GeneratedRoute {
  id: string;
  geojson: RouteFeature;
  mapGeojson?: RouteMapGeoJson;
  metrics: RouteMetrics;
  gpx: string;
  createdAt: string;
  /** BRouter OSM-tagged length slices — used by quality audits. */
  segments?: { tags: OsmTags; distanceM: number }[];
  /**
   * Pre-prune BRouter polyline (on-network reference). Display geometry should
   * stay within a few meters of this path; air-chords diverge from it.
   */
  networkCoordinates?: [number, number][];
  /** Present when the route was relaxed or shipped as a last-resort fallback. */
  generationQuality?: RouteGenerationQuality;
}

/** Post-ride star rating (1 = poor, 5 = great). */
export type RouteRating = 1 | 2 | 3 | 4 | 5;

export interface StoredRoute extends GeneratedRoute {
  bikeType: BikeType;
  direction: Direction;
  start: LatLng;
  profile?: RideProfile;
  planningMode?: PlanningMode;
  avoidAsphalt?: boolean;
  preferQuietRoutes?: boolean;
  approachEnabled?: boolean;
  /** Configured approach target distance (km). */
  approachDistanceKm?: number;
  loopEntry?: LatLng;
  viaPoints?: RouteViaPoint[];
  /** Post-ride star rating; set after the user rides the loop. */
  rating?: RouteRating;
  /** Problem / quality tags from post-ride feedback. */
  feedbackTags?: string[];
  notes?: string;
  /** When the user first submitted post-ride feedback. */
  riddenAt?: string;
  /** Public share slug when sharing is enabled (`/r/{shareSlug}`). */
  shareSlug?: string;
  /** Saved to favorites — survives history prune. */
  isFavorite?: boolean;
  favoritedAt?: string;
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
  | { type: "complete"; route: StoredRoute; variants?: StoredRoute[] }
  | { type: "error"; error: string };
