import type { GenerateRouteRequest } from "@loopforge/osm-types";
import {
  createServiceClient,
  isServiceRoleConfigured,
} from "@/lib/supabase/admin";

export type GenerationEventStatus = "success" | "error";

export interface LogGenerationEventInput {
  userId: string | null;
  request: GenerateRouteRequest;
  status: GenerationEventStatus;
  latencyMs: number;
  errorMessage?: string;
  routeId?: string;
}

/** Best-effort ops log — never throws to the caller. */
export async function logGenerationEvent(
  input: LogGenerationEventInput,
): Promise<void> {
  if (!isServiceRoleConfigured()) return;
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("generation_events").insert({
      user_id: input.userId,
      bike_type: input.request.bikeType,
      distance_km: input.request.distanceKm,
      direction: input.request.direction,
      profile: input.request.profile ?? null,
      approach_enabled: Boolean(input.request.approachEnabled),
      start_lat: input.request.start.lat,
      start_lng: input.request.start.lng,
      status: input.status,
      latency_ms: Math.round(input.latencyMs),
      error_message: input.errorMessage ?? null,
      route_id: input.routeId ?? null,
    });
    if (error) {
      console.warn("[generation_events]", error.message);
    }
  } catch (err) {
    console.warn(
      "[generation_events]",
      err instanceof Error ? err.message : err,
    );
  }
}
