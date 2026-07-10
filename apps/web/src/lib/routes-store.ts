import { promises as fs } from "node:fs";
import path from "node:path";
import type { StoredRoute } from "@loopforge/osm-types";

const ROUTES_PATH = path.join(process.cwd(), "../../data/routes.json");

export async function loadRoutes(): Promise<StoredRoute[]> {
  try {
    const raw = await fs.readFile(ROUTES_PATH, "utf8");
    return JSON.parse(raw) as StoredRoute[];
  } catch {
    return [];
  }
}

export async function saveRoute(route: StoredRoute): Promise<void> {
  const routes = await loadRoutes();
  routes.unshift(route);
  await fs.mkdir(path.dirname(ROUTES_PATH), { recursive: true });
  await fs.writeFile(ROUTES_PATH, JSON.stringify(routes, null, 2), "utf8");
}

export async function updateRouteRating(
  id: string,
  rating: "up" | "down",
  notes?: string,
): Promise<StoredRoute | null> {
  const routes = await loadRoutes();
  const index = routes.findIndex((route) => route.id === id);
  if (index === -1) return null;

  routes[index] = {
    ...routes[index],
    rating,
    ...(notes !== undefined ? { notes } : {}),
  };
  await fs.writeFile(ROUTES_PATH, JSON.stringify(routes, null, 2), "utf8");
  return routes[index];
}

export async function getRouteById(id: string): Promise<StoredRoute | null> {
  const routes = await loadRoutes();
  return routes.find((route) => route.id === id) ?? null;
}
