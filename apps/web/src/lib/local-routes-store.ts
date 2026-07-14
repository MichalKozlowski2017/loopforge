import type { BikeType, Direction, RideProfile, StoredRoute } from "@loopforge/osm-types";

const STORAGE_KEY = "loopforge:routes";
const MAX_STORED_ROUTES = 25;

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

function writeRoutes(routes: StoredRoute[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
}

/** Drop GPX payload — geometry in geojson is enough to rebuild the file on demand. */
function trimForStorage(route: StoredRoute): StoredRoute {
  return { ...route, gpx: "" };
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
  const routes = readRoutes().filter((item) => item.id !== route.id);
  routes.unshift(trimForStorage(route));
  writeRoutes(routes.slice(0, MAX_STORED_ROUTES));
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
