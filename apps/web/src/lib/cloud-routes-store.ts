import type {
  BikeType,
  Direction,
  RideProfile,
  StoredRoute,
} from "@loopforge/osm-types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_CLOUD_ROUTES = 25;

export interface CloudRouteSummary {
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
}

type RouteRow = {
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
  rating: "up" | "down" | null;
  notes: string | null;
  created_at: string;
};

type SummaryRow = {
  id: string;
  bike_type: string;
  direction: string;
  profile: string | null;
  metrics: StoredRoute["metrics"];
  rating: "up" | "down" | null;
  notes: string | null;
  created_at: string;
};

function rowToStored(row: RouteRow): StoredRoute {
  return {
    id: row.id,
    bikeType: row.bike_type as BikeType,
    direction: row.direction as Direction,
    profile: (row.profile as RideProfile | null) ?? undefined,
    start: { lat: row.start_lat, lng: row.start_lng },
    geojson: row.geojson,
    mapGeojson: row.map_geojson ?? undefined,
    metrics: row.metrics,
    gpx: row.gpx ?? "",
    rating: row.rating ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
  };
}

function rowToSummary(row: SummaryRow): CloudRouteSummary {
  return {
    id: row.id,
    bikeType: row.bike_type as BikeType,
    direction: row.direction as Direction,
    profile: (row.profile as RideProfile | null) ?? undefined,
    distanceKm: row.metrics?.distanceKm ?? 0,
    score: row.metrics?.score ?? 0,
    elevationGainM: row.metrics?.elevationGainM ?? 0,
    rating: row.rating ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
  };
}

export async function listRouteSummaries(
  supabase: SupabaseClient,
  userId: string,
): Promise<CloudRouteSummary[]> {
  const { data, error } = await supabase
    .from("routes")
    .select("id, bike_type, direction, profile, metrics, rating, notes, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_CLOUD_ROUTES);

  if (error) throw new Error(error.message);
  return (data as SummaryRow[] | null)?.map(rowToSummary) ?? [];
}

export async function getRouteById(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<StoredRoute | null> {
  const { data, error } = await supabase
    .from("routes")
    .select(
      "id, bike_type, direction, profile, start_lat, start_lng, geojson, map_geojson, metrics, gpx, rating, notes, created_at",
    )
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return rowToStored(data as RouteRow);
}

/** Drop audit-only payloads that are not needed for map/history replay. */
function forCloudStorage(route: StoredRoute): StoredRoute {
  const {
    segments: _segments,
    networkCoordinates: _network,
    ...rest
  } = route;
  return rest;
}

export async function saveRoute(
  supabase: SupabaseClient,
  userId: string,
  route: StoredRoute,
): Promise<StoredRoute> {
  const stored = forCloudStorage(route);
  const { error: insertError } = await supabase.from("routes").upsert(
    {
      id: stored.id,
      user_id: userId,
      bike_type: stored.bikeType,
      direction: stored.direction,
      profile: stored.profile ?? null,
      start_lat: stored.start.lat,
      start_lng: stored.start.lng,
      geojson: stored.geojson,
      map_geojson: stored.mapGeojson ?? null,
      metrics: stored.metrics,
      gpx: stored.gpx ?? "",
      rating: stored.rating ?? null,
      notes: stored.notes ?? null,
      created_at: stored.createdAt,
    },
    { onConflict: "id" },
  );

  if (insertError) throw new Error(insertError.message);

  // Keep only the newest MAX_CLOUD_ROUTES for this user.
  const { data: ids, error: listError } = await supabase
    .from("routes")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (listError) throw new Error(listError.message);

  const overflow = (ids ?? []).slice(MAX_CLOUD_ROUTES).map((row) => row.id as string);
  if (overflow.length > 0) {
    const { error: deleteError } = await supabase
      .from("routes")
      .delete()
      .eq("user_id", userId)
      .in("id", overflow);
    if (deleteError) throw new Error(deleteError.message);
  }

  return stored;
}

export async function updateRouteRating(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  rating: "up" | "down",
  notes?: string,
): Promise<StoredRoute | null> {
  const patch: { rating: "up" | "down"; notes?: string } = { rating };
  if (notes !== undefined) patch.notes = notes;

  const { data, error } = await supabase
    .from("routes")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", id)
    .select(
      "id, bike_type, direction, profile, start_lat, start_lng, geojson, map_geojson, metrics, gpx, rating, notes, created_at",
    )
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return rowToStored(data as RouteRow);
}

export async function getRouteGpx(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("routes")
    .select("gpx")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return (data.gpx as string) ?? "";
}
