import type {
  BikeType,
  Direction,
  RideProfile,
  RouteMapGeoJson,
  StoredRoute,
} from "@loopforge/osm-types";

const STORAGE_KEY = "loopforge:routes";
/** Keep history small — each metro 50 km route is multi‑MB as JSON. */
const MAX_STORED_ROUTES = 10;
/** Soft budget under typical ~5 MB origin quota (UTF-16 ≈ 2 bytes/char). */
const MAX_STORAGE_CHARS = 2_200_000;
const DISPLAY_MAX_POINTS = 2_500;
const AGGRESSIVE_MAX_POINTS = 900;

export interface LocalRouteSummary {
  id: string;
  bikeType: BikeType;
  direction: Direction;
  profile?: RideProfile;
  distanceKm: number;
  score: number;
  elevationGainM: number;
  rating?: "up" | "down";
  notes?: string;
  createdAt: string;
  placeholder: boolean;
}

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22
  );
}

function downsampleCoordinates(
  coordinates: [number, number][],
  maxPoints: number,
): [number, number][] {
  if (coordinates.length <= maxPoints || maxPoints < 3) return coordinates;
  const out: [number, number][] = [];
  const last = coordinates.length - 1;
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i * last) / (maxPoints - 1));
    const point = coordinates[idx]!;
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) {
      out.push(point);
    }
  }
  return out;
}

function downsampleMapGeojson(
  mapGeojson: RouteMapGeoJson | undefined,
  maxPointsPerFeature: number,
): RouteMapGeoJson | undefined {
  if (!mapGeojson?.features?.length) return undefined;
  return {
    type: "FeatureCollection",
    features: mapGeojson.features.map((feature) => ({
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: downsampleCoordinates(
          feature.geometry.coordinates as [number, number][],
          maxPointsPerFeature,
        ),
      },
    })),
  };
}

/**
 * Drop audit/export-only payloads and thin display geometry so localStorage
 * can hold a few recent rides without blowing the origin quota.
 */
function trimForStorage(
  route: StoredRoute,
  options: { maxPoints: number; keepMap: boolean },
): StoredRoute {
  const coordinates = downsampleCoordinates(
    route.geojson.geometry.coordinates as [number, number][],
    options.maxPoints,
  );
  const trimmed: StoredRoute = {
    ...route,
    gpx: "",
    segments: undefined,
    networkCoordinates: undefined,
    geojson: {
      ...route.geojson,
      geometry: {
        ...route.geojson.geometry,
        coordinates,
      },
    },
  };
  if (options.keepMap && route.mapGeojson) {
    trimmed.mapGeojson = downsampleMapGeojson(
      route.mapGeojson,
      Math.max(80, Math.floor(options.maxPoints / 4)),
    );
  } else {
    delete trimmed.mapGeojson;
  }
  return trimmed;
}

function payloadSize(routes: StoredRoute[]): number {
  return JSON.stringify(routes).length;
}

function readRoutes(): StoredRoute[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredRoute[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function tryWrite(routes: StoredRoute[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    const payload = JSON.stringify(routes);
    if (payload.length > MAX_STORAGE_CHARS) return false;
    window.localStorage.setItem(STORAGE_KEY, payload);
    return true;
  } catch (error) {
    if (isQuotaError(error)) return false;
    throw error;
  }
}

/**
 * Persist with progressive fallbacks: fewer routes → less geometry → no map
 * overlay → single stripped route. Never throws QuotaExceededError.
 */
function writeRoutes(routes: StoredRoute[]): void {
  if (typeof window === "undefined") return;

  let candidates = routes.slice(0, MAX_STORED_ROUTES);
  const attempts: StoredRoute[][] = [
    candidates,
    candidates.slice(0, 6),
    candidates.slice(0, 3),
    candidates.slice(0, 1),
  ];

  for (const batch of attempts) {
    if (tryWrite(batch)) return;
  }

  // Last resort: strip map overlays and re-thin the newest route only.
  const newest = candidates[0];
  if (!newest) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return;
  }

  const stripped = [
    trimForStorage(newest, { maxPoints: AGGRESSIVE_MAX_POINTS, keepMap: false }),
  ];
  if (tryWrite(stripped)) return;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
    tryWrite(stripped);
  } catch {
    // History is best-effort — generation UI must still work.
  }
}

export function loadLocalRouteSummaries(): LocalRouteSummary[] {
  return readRoutes().map((route) => ({
    id: route.id,
    bikeType: route.bikeType,
    direction: route.direction,
    profile: route.profile,
    distanceKm: route.metrics.distanceKm,
    score: route.metrics.score,
    elevationGainM: route.metrics.elevationGainM,
    rating: route.rating,
    notes: route.notes,
    createdAt: route.createdAt,
    placeholder: route.geojson.properties.placeholder === true,
  }));
}

export function getLocalRouteById(id: string): StoredRoute | null {
  return readRoutes().find((route) => route.id === id) ?? null;
}

export function saveLocalRoute(route: StoredRoute): void {
  const existing = readRoutes().filter((item) => item.id !== route.id);
  const light = trimForStorage(route, {
    maxPoints: DISPLAY_MAX_POINTS,
    keepMap: true,
  });
  const aggressive = trimForStorage(route, {
    maxPoints: AGGRESSIVE_MAX_POINTS,
    keepMap: false,
  });

  // Prefer keeping colour overlay when it still fits.
  const withMap = [light, ...existing].slice(0, MAX_STORED_ROUTES);
  if (payloadSize(withMap) <= MAX_STORAGE_CHARS && tryWrite(withMap)) return;

  const withoutMap = [aggressive, ...existing.map((r) =>
    trimForStorage(r, { maxPoints: AGGRESSIVE_MAX_POINTS, keepMap: false }),
  )].slice(0, MAX_STORED_ROUTES);
  writeRoutes(withoutMap);
}

export function updateLocalRouteRating(
  id: string,
  rating: "up" | "down",
  notes?: string,
): StoredRoute | null {
  const routes = readRoutes();
  const index = routes.findIndex((route) => route.id === id);
  if (index === -1) return null;

  routes[index] = {
    ...routes[index],
    rating,
    ...(notes !== undefined ? { notes } : {}),
  };
  writeRoutes(routes);
  return routes[index];
}
