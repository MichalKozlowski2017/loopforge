import { promises as fs } from "node:fs";
import path from "node:path";
import type { StoredRoute } from "@loopforge/osm-types";
import {
  getRoutingConfig,
  isRoutingConfigured,
  withClient,
} from "@loopforge/routing";

const ROUTES_PATH = path.join(process.cwd(), "../../data/routes.json");
const MAX_STORED_ROUTES = 25;

function shouldUseDatabaseStore(): boolean {
  return isRoutingConfigured();
}

export async function loadRoutes(): Promise<StoredRoute[]> {
  if (shouldUseDatabaseStore()) {
    const config = getRoutingConfig();
    if (!config) return [];

    return withClient(config, async (client) => {
      const result = await client.query<{
        id: string;
        bike_type: string;
        direction: string;
        profile: string | null;
        start_lat: number;
        start_lng: number;
        geojson: StoredRoute["geojson"];
        map_geojson: StoredRoute["mapGeojson"] | null;
        metrics: StoredRoute["metrics"];
        gpx: string;
        rating: number | null;
        notes: string | null;
        created_at: string;
      }>(
        `
          select
            id::text,
            bike_type,
            direction,
            profile,
            start_lat,
            start_lng,
            geojson,
            map_geojson,
            metrics,
            gpx,
            rating,
            notes,
            created_at
          from public.routes
          order by created_at desc
          limit $1
        `,
        [MAX_STORED_ROUTES],
      );

      return result.rows.map((row) => ({
        id: row.id,
        bikeType: row.bike_type as StoredRoute["bikeType"],
        direction: row.direction as StoredRoute["direction"],
        profile: (row.profile as StoredRoute["profile"]) ?? undefined,
        start: { lat: row.start_lat, lng: row.start_lng },
        geojson: row.geojson,
        mapGeojson: row.map_geojson ?? undefined,
        metrics: row.metrics,
        gpx: row.gpx,
        rating: (row.rating != null &&
        row.rating >= 1 &&
        row.rating <= 5
          ? (row.rating as StoredRoute["rating"])
          : undefined),
        notes: row.notes ?? undefined,
        createdAt: row.created_at,
      }));
    });
  }

  try {
    const raw = await fs.readFile(ROUTES_PATH, "utf8");
    return JSON.parse(raw) as StoredRoute[];
  } catch {
    return [];
  }
}

function trimForStorage(route: StoredRoute): StoredRoute {
  return { ...route, gpx: "" };
}

export async function saveRoute(route: StoredRoute): Promise<void> {
  if (shouldUseDatabaseStore()) {
    const config = getRoutingConfig();
    if (!config) throw new Error("DATABASE_URL is not configured");

    await withClient(config, async (client) => {
      await client.query(
        `
          insert into public.routes (
            id,
            bike_type,
            direction,
            profile,
            start_lat,
            start_lng,
            geojson,
            map_geojson,
            metrics,
            gpx,
            created_at
          ) values (
            $1::uuid,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7::jsonb,
            $8::jsonb,
            $9::jsonb,
            $10,
            $11::timestamptz
          )
        `,
        [
          route.id,
          route.bikeType,
          route.direction,
          route.profile ?? null,
          route.start.lat,
          route.start.lng,
          JSON.stringify(route.geojson),
          route.mapGeojson ? JSON.stringify(route.mapGeojson) : null,
          JSON.stringify(route.metrics),
          route.gpx,
          route.createdAt,
        ],
      );
    });
    return;
  }

  const routes = await loadRoutes();
  routes.unshift(trimForStorage(route));
  const trimmed = routes.slice(0, MAX_STORED_ROUTES);
  await fs.mkdir(path.dirname(ROUTES_PATH), { recursive: true });
  await fs.writeFile(ROUTES_PATH, JSON.stringify(trimmed, null, 2), "utf8");
}

export async function updateRouteRating(
  id: string,
  rating: 1 | 2 | 3 | 4 | 5,
  notes?: string,
  tags?: string[],
): Promise<StoredRoute | null> {
  if (shouldUseDatabaseStore()) {
    const config = getRoutingConfig();
    if (!config) return null;

    return withClient(config, async (client) => {
      const result = await client.query<{ id: string }>(
        `
          update public.routes
          set
            rating = $2,
            notes = coalesce($3, notes),
            feedback_tags = coalesce($4::text[], feedback_tags),
            ridden_at = coalesce(ridden_at, now())
          where id = $1::uuid
          returning id::text
        `,
        [id, rating, notes ?? null, tags ?? null],
      );
      if (result.rowCount === 0) return null;
      const routes = await loadRoutes();
      return routes.find((route) => route.id === id) ?? null;
    });
  }

  const routes = await loadRoutes();
  const index = routes.findIndex((route) => route.id === id);
  if (index === -1) return null;

  const existing = routes[index]!;
  routes[index] = {
    ...existing,
    rating,
    ...(notes !== undefined ? { notes } : {}),
    ...(tags !== undefined ? { feedbackTags: tags } : {}),
    riddenAt: existing.riddenAt ?? new Date().toISOString(),
  };
  await fs.writeFile(ROUTES_PATH, JSON.stringify(routes, null, 2), "utf8");
  return routes[index]!;
}

export async function getRouteById(id: string): Promise<StoredRoute | null> {
  if (shouldUseDatabaseStore()) {
    const config = getRoutingConfig();
    if (!config) return null;

    return withClient(config, async (client) => {
      const result = await client.query<{ id: string }>(
        `
          select id::text
          from public.routes
          where id = $1::uuid
        `,
        [id],
      );
      if (result.rowCount === 0) return null;
      const routes = await loadRoutes();
      const route = routes.find((item) => item.id === id) ?? null;
      if (!route) return null;

      if (!route.gpx) {
        const gpxResult = await client.query<{ gpx: string }>(
          `select gpx from public.routes where id = $1::uuid`,
          [id],
        );
        route.gpx = gpxResult.rows[0]?.gpx ?? "";
      }
      return route;
    });
  }

  const routes = await loadRoutes();
  return routes.find((route) => route.id === id) ?? null;
}
