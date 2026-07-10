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

export interface LatLng {
  lat: number;
  lng: number;
}

export interface OsmTags {
  highway?: string;
  surface?: string;
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

export interface RouteMetrics {
  distanceKm: number;
  elevationGainM: number;
  surfaceBreakdown: Record<string, number>;
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

export interface GeneratedRoute {
  id: string;
  geojson: RouteFeature;
  metrics: RouteMetrics;
  gpx: string;
  createdAt: string;
}

export interface StoredRoute extends GeneratedRoute {
  bikeType: BikeType;
  direction: Direction;
  start: LatLng;
  rating?: "up" | "down";
}
