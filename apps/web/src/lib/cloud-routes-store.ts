import type {
  BikeType,
  Direction,
  RideProfile,
  RouteRating,
  StoredRoute,
} from "@loopforge/osm-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RouteFeedbackTagId } from "@/lib/route-feedback";
import { extractPreviewPath } from "@/lib/route-shape-preview";

export const MAX_CLOUD_ROUTES = 25;
/** Favorites are kept outside the rolling history window. */
export const MAX_FAVORITE_ROUTES = 50;

export interface CloudRouteSummary {
  id: string;
  bikeType: BikeType;
  direction: Direction;
  profile?: RideProfile;
  distanceKm: number;
  score: number;
  elevationGainM: number;
  rating?: RouteRating;
  feedbackTags?: string[];
  notes?: string;
  riddenAt?: string;
  createdAt: string;
  isFavorite?: boolean;
  /** Downsampled [lng, lat] polyline for list thumbnails. */
  previewPath?: [number, number][];
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
  rating: number | null;
  feedback_tags: string[] | null;
  notes: string | null;
  ridden_at: string | null;
  share_slug: string | null;
  is_favorite: boolean | null;
  favorited_at: string | null;
  created_at: string;
};

type SummaryRow = {
  id: string;
  bike_type: string;
  direction: string;
  profile: string | null;
  metrics: StoredRoute["metrics"];
  rating: number | null;
  feedback_tags: string[] | null;
  notes: string | null;
  ridden_at: string | null;
  created_at: string;
  is_favorite?: boolean | null;
  geojson?: StoredRoute["geojson"] | null;
};

function asRouteRating(value: number | null): RouteRating | undefined {
  if (value == null) return undefined;
  if (value >= 1 && value <= 5 && Number.isInteger(value)) {
    return value as RouteRating;
  }
  return undefined;
}

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
    rating: asRouteRating(row.rating),
    feedbackTags: row.feedback_tags?.length ? row.feedback_tags : undefined,
    notes: row.notes ?? undefined,
    riddenAt: row.ridden_at ?? undefined,
    shareSlug: row.share_slug ?? undefined,
    isFavorite: Boolean(row.is_favorite),
    favoritedAt: row.favorited_at ?? undefined,
    createdAt: row.created_at,
  };
}

function rowToSummary(row: SummaryRow): CloudRouteSummary {
  const previewPath = extractPreviewPath(row.geojson);
  return {
    id: row.id,
    bikeType: row.bike_type as BikeType,
    direction: row.direction as Direction,
    profile: (row.profile as RideProfile | null) ?? undefined,
    distanceKm: row.metrics?.distanceKm ?? 0,
    score: row.metrics?.score ?? 0,
    elevationGainM: row.metrics?.elevationGainM ?? 0,
    rating: asRouteRating(row.rating),
    feedbackTags: row.feedback_tags?.length ? row.feedback_tags : undefined,
    notes: row.notes ?? undefined,
    riddenAt: row.ridden_at ?? undefined,
    createdAt: row.created_at,
    isFavorite: Boolean(row.is_favorite),
    previewPath: previewPath.length >= 2 ? previewPath : undefined,
  };
}

const FULL_SELECT =
  "id, bike_type, direction, profile, start_lat, start_lng, geojson, map_geojson, metrics, gpx, rating, feedback_tags, notes, ridden_at, share_slug, is_favorite, favorited_at, created_at";

const SUMMARY_SELECT =
  "id, bike_type, direction, profile, metrics, rating, feedback_tags, notes, ridden_at, created_at, is_favorite, geojson";

const SHARE_SELECT =
  "id, bike_type, direction, profile, start_lat, start_lng, geojson, map_geojson, metrics, gpx, created_at, share_slug";

export async function listRouteSummaries(
  supabase: SupabaseClient,
  userId: string,
): Promise<CloudRouteSummary[]> {
  const { data, error } = await supabase
    .from("routes")
    .select(SUMMARY_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_CLOUD_ROUTES);

  if (error) throw new Error(error.message);
  return (data as SummaryRow[] | null)?.map(rowToSummary) ?? [];
}

export async function listFavoriteSummaries(
  supabase: SupabaseClient,
  userId: string,
): Promise<CloudRouteSummary[]> {
  const { data, error } = await supabase
    .from("routes")
    .select(SUMMARY_SELECT)
    .eq("user_id", userId)
    .eq("is_favorite", true)
    .order("favorited_at", { ascending: false })
    .limit(MAX_FAVORITE_ROUTES);

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
    .select(FULL_SELECT)
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
      feedback_tags: stored.feedbackTags ?? [],
      notes: stored.notes ?? null,
      ridden_at: stored.riddenAt ?? null,
      created_at: stored.createdAt,
    },
    { onConflict: "id" },
  );

  if (insertError) throw new Error(insertError.message);

  // Prune rolling history only — favorites are never auto-deleted.
  const { data: nonFavorites, error: listError } = await supabase
    .from("routes")
    .select("id")
    .eq("user_id", userId)
    .eq("is_favorite", false)
    .order("created_at", { ascending: false });

  if (listError) throw new Error(listError.message);

  const overflow = (nonFavorites ?? [])
    .slice(MAX_CLOUD_ROUTES)
    .map((row) => row.id as string);
  if (overflow.length > 0) {
    const { error: deleteError } = await supabase
      .from("routes")
      .delete()
      .eq("user_id", userId)
      .eq("is_favorite", false)
      .in("id", overflow);
    if (deleteError) throw new Error(deleteError.message);
  }

  return stored;
}

export async function updateRouteRating(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  rating: RouteRating,
  notes?: string,
  tags?: RouteFeedbackTagId[],
): Promise<StoredRoute | null> {
  const existing = await getRouteById(supabase, userId, id);
  if (!existing) return null;

  const patch: {
    rating: RouteRating;
    notes?: string;
    feedback_tags: string[];
    ridden_at?: string;
  } = {
    rating,
    feedback_tags: tags ?? existing.feedbackTags ?? [],
  };
  if (notes !== undefined) patch.notes = notes;
  if (!existing.riddenAt) {
    patch.ridden_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("routes")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", id)
    .select(FULL_SELECT)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return rowToStored(data as RouteRow);
}

export async function setRouteFavorite(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  enabled: boolean,
): Promise<StoredRoute | null> {
  const existing = await getRouteById(supabase, userId, id);
  if (!existing) return null;

  if (enabled && !existing.isFavorite) {
    const { count, error: countError } = await supabase
      .from("routes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_favorite", true);
    if (countError) throw new Error(countError.message);
    if ((count ?? 0) >= MAX_FAVORITE_ROUTES) {
      throw new Error(
        `Limit ulubionych to ${MAX_FAVORITE_ROUTES}. Usuń którąś, żeby dodać nową.`,
      );
    }
  }

  const { data, error } = await supabase
    .from("routes")
    .update({
      is_favorite: enabled,
      favorited_at: enabled ? new Date().toISOString() : null,
    })
    .eq("user_id", userId)
    .eq("id", id)
    .select(FULL_SELECT)
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

function createShareSlug(): string {
  // 12 bytes → 16 chars base64url, unguessable enough for share links
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function setRouteSharing(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  enabled: boolean,
): Promise<StoredRoute | null> {
  const existing = await getRouteById(supabase, userId, id);
  if (!existing) return null;

  let shareSlug: string | null = null;
  if (enabled) {
    shareSlug = existing.shareSlug ?? createShareSlug();
  }

  const { data, error } = await supabase
    .from("routes")
    .update({ share_slug: shareSlug })
    .eq("user_id", userId)
    .eq("id", id)
    .select(FULL_SELECT)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return rowToStored(data as RouteRow);
}

/** Public shared route payload — no private notes/ratings. */
export type SharedRoutePublic = {
  id: string;
  bikeType: BikeType;
  direction: Direction;
  profile?: RideProfile;
  start: { lat: number; lng: number };
  geojson: StoredRoute["geojson"];
  mapGeojson?: StoredRoute["mapGeojson"];
  metrics: StoredRoute["metrics"];
  gpx: string;
  createdAt: string;
  shareSlug: string;
};

export async function getSharedRouteBySlug(
  service: SupabaseClient,
  slug: string,
): Promise<SharedRoutePublic | null> {
  const normalized = slug.trim();
  if (!normalized || normalized.length > 64) return null;

  const { data, error } = await service
    .from("routes")
    .select(SHARE_SELECT)
    .eq("share_slug", normalized)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as {
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
    created_at: string;
    share_slug: string;
  };

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
    createdAt: row.created_at,
    shareSlug: row.share_slug,
  };
}
