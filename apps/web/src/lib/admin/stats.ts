import { createServiceClient } from "@/lib/supabase/admin";

export interface AdminDashboardStats {
  usersTotal: number;
  routesLast24h: number;
  routesLast7d: number;
  routesTotal: number;
  generationsLast24h: { success: number; error: number; avgLatencyMs: number | null };
  ratings: {
    none: number;
    average: number | null;
    distribution: Record<1 | 2 | 3 | 4 | 5, number>;
    goodShare: number | null;
  };
  topBikeTypes: { bikeType: string; count: number }[];
  topProfiles: { profile: string; count: number }[];
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

export async function getDashboardStats(): Promise<AdminDashboardStats> {
  const supabase = createServiceClient();
  const since24h = hoursAgoIso(24);
  const since7d = hoursAgoIso(24 * 7);

  const [
    usersTotal,
    routes24h,
    routes7d,
    routesTotal,
    gens24h,
    ratingsRows,
    bikeRows,
    profileRows,
  ] = await Promise.all([
    countAuthUsers(),
    supabase
      .from("routes")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since24h),
    supabase
      .from("routes")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since7d),
    supabase.from("routes").select("id", { count: "exact", head: true }),
    supabase
      .from("generation_events")
      .select("status, latency_ms")
      .gte("created_at", since24h),
    supabase.from("routes").select("rating"),
    supabase.from("routes").select("bike_type"),
    supabase.from("routes").select("profile").not("profile", "is", null),
  ]);

  let success = 0;
  let error = 0;
  let latencySum = 0;
  let latencyN = 0;
  for (const row of gens24h.data ?? []) {
    if (row.status === "success") success += 1;
    else if (row.status === "error") error += 1;
    if (typeof row.latency_ms === "number") {
      latencySum += row.latency_ms;
      latencyN += 1;
    }
  }

  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  let none = 0;
  let sum = 0;
  let rated = 0;
  let good = 0;
  for (const row of ratingsRows.data ?? []) {
    const value = row.rating as number | null;
    if (value == null || value < 1 || value > 5) {
      none += 1;
      continue;
    }
    const star = value as 1 | 2 | 3 | 4 | 5;
    distribution[star] += 1;
    sum += star;
    rated += 1;
    if (star >= 4) good += 1;
  }
  const ratings = {
    none,
    average: rated ? Math.round((sum / rated) * 10) / 10 : null,
    distribution,
    goodShare: rated ? Math.round((good / rated) * 100) : null,
  };

  const bikeCounts = new Map<string, number>();
  for (const row of bikeRows.data ?? []) {
    const key = String(row.bike_type ?? "unknown");
    bikeCounts.set(key, (bikeCounts.get(key) ?? 0) + 1);
  }
  const topBikeTypes = [...bikeCounts.entries()]
    .map(([bikeType, count]) => ({ bikeType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const profileCounts = new Map<string, number>();
  for (const row of profileRows.data ?? []) {
    const key = String(row.profile ?? "unknown");
    profileCounts.set(key, (profileCounts.get(key) ?? 0) + 1);
  }
  const topProfiles = [...profileCounts.entries()]
    .map(([profile, count]) => ({ profile, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    usersTotal,
    routesLast24h: routes24h.count ?? 0,
    routesLast7d: routes7d.count ?? 0,
    routesTotal: routesTotal.count ?? 0,
    generationsLast24h: {
      success,
      error,
      avgLatencyMs: latencyN ? Math.round(latencySum / latencyN) : null,
    },
    ratings,
    topBikeTypes,
    topProfiles,
  };
}

async function countAuthUsers(): Promise<number> {
  const supabase = createServiceClient();
  let page = 1;
  let total = 0;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(error.message);
    const batch = data.users?.length ?? 0;
    total += batch;
    if (batch < 200 || page >= 25) break;
    page += 1;
  }
  return total;
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  providers: string[];
  createdAt: string;
  lastSignInAt: string | null;
  banned: boolean;
  routeCount: number;
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (error) throw new Error(error.message);

  const users = data.users ?? [];
  const ids = users.map((u) => u.id);
  const countByUser = new Map<string, number>();
  if (ids.length) {
    const { data: routeRows } = await supabase
      .from("routes")
      .select("user_id")
      .in("user_id", ids);
    for (const row of routeRows ?? []) {
      const uid = row.user_id as string;
      countByUser.set(uid, (countByUser.get(uid) ?? 0) + 1);
    }
  }

  return users
    .map((u) => ({
      id: u.id,
      email: u.email ?? null,
      providers: (u.app_metadata?.providers as string[] | undefined) ??
        (u.app_metadata?.provider ? [String(u.app_metadata.provider)] : []),
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      banned: Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
      routeCount: countByUser.get(u.id) ?? 0,
    }))
    .sort((a, b) => (b.lastSignInAt ?? "").localeCompare(a.lastSignInAt ?? ""));
}

export async function setUserBanned(
  userId: string,
  banned: boolean,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: banned ? "876000h" : "none",
  });
  if (error) throw new Error(error.message);
}

export interface AdminFeedbackRow {
  id: string;
  userId: string;
  bikeType: string;
  distanceKm: number;
  rating: number;
  feedbackTags: string[];
  notes: string | null;
  createdAt: string;
  score: number | null;
}

/** Low post-ride ratings (1–3) for ops review. */
export async function listDownFeedback(
  limit = 50,
): Promise<AdminFeedbackRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("routes")
    .select(
      "id, user_id, bike_type, metrics, notes, created_at, rating, feedback_tags",
    )
    .not("rating", "is", null)
    .lte("rating", 3)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const metrics = row.metrics as { distanceKm?: number; score?: number } | null;
    return {
      id: row.id as string,
      userId: row.user_id as string,
      bikeType: String(row.bike_type),
      distanceKm: metrics?.distanceKm ?? 0,
      rating: Number(row.rating),
      feedbackTags: (row.feedback_tags as string[] | null) ?? [],
      notes: (row.notes as string | null) ?? null,
      createdAt: row.created_at as string,
      score: metrics?.score ?? null,
    };
  });
}

export interface AdminGenerationRow {
  id: string;
  userId: string | null;
  createdAt: string;
  bikeType: string | null;
  distanceKm: number | null;
  direction: string | null;
  profile: string | null;
  status: string;
  latencyMs: number | null;
  errorMessage: string | null;
  routeId: string | null;
}

export async function listGenerations(
  limit = 80,
  status?: "success" | "error",
): Promise<AdminGenerationRow[]> {
  const supabase = createServiceClient();
  let query = supabase
    .from("generation_events")
    .select(
      "id, user_id, created_at, bike_type, distance_km, direction, profile, status, latency_ms, error_message, route_id",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    createdAt: row.created_at as string,
    bikeType: (row.bike_type as string | null) ?? null,
    distanceKm: (row.distance_km as number | null) ?? null,
    direction: (row.direction as string | null) ?? null,
    profile: (row.profile as string | null) ?? null,
    status: row.status as string,
    latencyMs: (row.latency_ms as number | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    routeId: (row.route_id as string | null) ?? null,
  }));
}

export interface BrouterHealth {
  ok: boolean;
  latencyMs: number | null;
  url: string | null;
  error: string | null;
}

export async function pingBrouter(): Promise<BrouterHealth> {
  const base = process.env.BROUTER_URL?.trim().replace(/\/$/, "") || null;
  if (!base) {
    return { ok: false, latencyMs: null, url: null, error: "Brak BROUTER_URL" };
  }
  const url = `${base}/brouter?lonlats=21.0,52.2|21.01,52.2&profile=trekking&format=geojson&engineMode=3`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        url: base,
        error: `HTTP ${res.status}`,
      };
    }
    return { ok: true, latencyMs, url: base, error: null };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      url: base,
      error: err instanceof Error ? err.message : "BRouter niedostępny",
    };
  }
}
