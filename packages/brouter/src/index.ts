export { getBrouterConfig, isBrouterConfigured, type BrouterConfig } from "./config";
export {
  buildColoredGeoJson,
  colorForSurface,
  SURFACE_LEGEND,
} from "./colored-geojson";
export {
  fetchRoundTrip,
  surfaceBreakdownFromSegments,
  type BrouterRouteResult,
  type RoundTripParams,
} from "./client";
export { ensureBrouterServer, stopBrouterServer } from "./server";
