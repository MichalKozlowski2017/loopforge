import {
  bearingBetween,
  directionFromBearing,
  generateRoute,
  validateViaPointsForRoute,
  validateWaypointsModePoints,
} from "@loopforge/generator";
import type {
  GenerateRouteRequest,
  RouteGenerationStreamEvent,
  StoredRoute,
} from "@loopforge/osm-types";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/supabase/require-user";
import { logGenerationEvent } from "@/lib/admin/generation-log";

function sseChunk(event: RouteGenerationStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function filterViaPoints(body: GenerateRouteRequest) {
  return body.viaPoints?.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      !(Math.abs(p.lat) < 0.0001 && Math.abs(p.lng) < 0.0001),
  );
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  let body: GenerateRouteRequest;
  try {
    body = (await request.json()) as GenerateRouteRequest;
  } catch {
    return Response.json({ error: "Nieprawidłowe JSON" }, { status: 400 });
  }

  if (
    !body.start ||
    typeof body.start.lat !== "number" ||
    typeof body.start.lng !== "number" ||
    !body.bikeType
  ) {
    return Response.json(
      { error: "Nieprawidłowe parametry żądania" },
      { status: 400 },
    );
  }

  const viaPoints = filterViaPoints(body);
  const waypointsMode = body.planningMode === "waypoints";

  let routeInput: GenerateRouteRequest;

  if (waypointsMode) {
    const viaCheck = validateWaypointsModePoints(body.start, viaPoints ?? []);
    if (!viaCheck.ok) {
      return Response.json(
        { error: viaCheck.message ?? "Nieprawidłowe punkty." },
        { status: 400 },
      );
    }
    const first = viaPoints![0]!;
    routeInput = {
      ...body,
      planningMode: "waypoints",
      direction:
        body.direction ??
        directionFromBearing(bearingBetween(body.start, first)),
      distanceKm:
        typeof body.distanceKm === "number" && body.distanceKm > 0
          ? body.distanceKm
          : 40,
      viaPoints,
      approachEnabled: false,
      approachDistanceKm: undefined,
    };
  } else {
    if (!body.direction || typeof body.distanceKm !== "number") {
      return Response.json(
        { error: "Nieprawidłowe parametry żądania" },
        { status: 400 },
      );
    }
    routeInput = {
      ...body,
      planningMode: body.planningMode ?? "loop",
      viaPoints: viaPoints?.length ? viaPoints : undefined,
    };

    if (routeInput.viaPoints?.length) {
      const viaCheck = validateViaPointsForRoute(
        {
          start: routeInput.start,
          direction: routeInput.direction,
          distanceKm: routeInput.distanceKm,
          approachEnabled: routeInput.approachEnabled,
          approachDistanceKm: routeInput.approachDistanceKm,
        },
        routeInput.viaPoints,
      );
      if (!viaCheck.ok) {
        return Response.json(
          { error: viaCheck.message ?? "Nieprawidłowe punkty przejazdu." },
          { status: 400 },
        );
      }
    }
  }

  const userId = auth.user?.id ?? null;
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: RouteGenerationStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(sseChunk(event));
        } catch {
          // Client aborted (BodyStreamBuffer) — stop writing.
          closed = true;
        }
      };

      try {
        const { route: generated, variants: generatedVariants } =
          await generateRoute(routeInput, {
            onProgress: (progress) => {
              send({ type: "progress", progress });
            },
          });

        const toStored = (generatedRoute: typeof generated): StoredRoute => ({
          ...generatedRoute,
          bikeType: routeInput.bikeType,
          direction: routeInput.direction,
          profile: routeInput.profile,
          planningMode: routeInput.planningMode,
          avoidAsphalt: routeInput.avoidAsphalt,
          preferQuietRoutes: routeInput.preferQuietRoutes,
          approachEnabled: routeInput.approachEnabled,
          approachDistanceKm: routeInput.approachEnabled
            ? routeInput.approachDistanceKm
            : undefined,
          viaPoints: routeInput.viaPoints,
          start: routeInput.start,
          loopEntry:
            routeInput.approachEnabled &&
            generatedRoute.geojson.properties.loopEntry &&
            typeof generatedRoute.geojson.properties.loopEntry === "object"
              ? (generatedRoute.geojson.properties
                  .loopEntry as StoredRoute["loopEntry"])
              : undefined,
        });

        const stored = toStored(generated);
        const storedVariants =
          generatedVariants && generatedVariants.length > 1
            ? generatedVariants.map(toStored)
            : undefined;

        void logGenerationEvent({
          userId,
          request: routeInput,
          status: "success",
          latencyMs: Date.now() - startedAt,
          routeId: stored.id,
        });

        send({
          type: "complete",
          route: stored,
          variants: storedVariants,
        });
      } catch (error) {
        console.error(error);
        Sentry.captureException(error, {
          tags: { area: "route-generate" },
          extra: {
            bikeType: routeInput.bikeType,
            distanceKm: routeInput.distanceKm,
            direction: routeInput.direction,
            profile: routeInput.profile,
            planningMode: routeInput.planningMode,
          },
        });
        const message =
          error instanceof Error ? error.message : "Błąd generowania trasy";
        void logGenerationEvent({
          userId,
          request: routeInput,
          status: "error",
          latencyMs: Date.now() - startedAt,
          errorMessage: message,
        });
        send({
          type: "error",
          error: message,
        });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            // already closed by client abort
          }
          closed = true;
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
