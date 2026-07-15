export { getBrouterConfig, isBrouterConfigured, type BrouterConfig } from "./config";
export {
  buildColoredGeoJson,
  buildColoredGeoJsonFromRoute,
  colorForSurface,
} from "./colored-geojson";
export { SURFACE_LEGEND } from "@loopforge/osm-types";
export {
  APPROACH_BROUTER_PROFILE,
  fetchApproachRouteBetweenPoints,
  fetchApproachRouteThroughPoints,
  fetchRouteBetweenPoints,
  fetchRouteThroughWaypoints,
  fetchRoundTrip,
  surfaceBreakdownFromSegments,
  type BrouterRouteResult,
  type RoundTripParams,
  type WaypointRouteParams,
} from "./client";
export { ensureBrouterServer, restartBrouterServer, stopBrouterServer } from "./server";
