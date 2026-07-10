export { getBrouterConfig, isBrouterConfigured, type BrouterConfig } from "./config";
export {
  buildColoredGeoJson,
  colorForSurface,
} from "./colored-geojson";
export { SURFACE_LEGEND } from "@loopforge/osm-types";
export {
  fetchRoundTrip,
  surfaceBreakdownFromSegments,
  type BrouterRouteResult,
  type RoundTripParams,
} from "./client";
export { ensureBrouterServer, stopBrouterServer } from "./server";
