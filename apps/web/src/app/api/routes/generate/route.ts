import { generateRoute, validateViaPointsForRoute } from "@loopforge/generator";
import type {
  GenerateRouteRequest,
  RouteGenerationStreamEvent,
  StoredRoute,
} from "@loopforge/osm-types";

function sseChunk(event: RouteGenerationStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: Request) {
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
    !body.bikeType ||
    !body.direction ||
    typeof body.distanceKm !== "number"
  ) {
    return Response.json(
      { error: "Nieprawidłowe parametry żądania" },
      { status: 400 },
    );
  }

  const viaPoints = body.viaPoints?.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      !(Math.abs(p.lat) < 0.0001 && Math.abs(p.lng) < 0.0001),
  );
  const routeInput: GenerateRouteRequest = {
    ...body,
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RouteGenerationStreamEvent) => {
        controller.enqueue(sseChunk(event));
      };

      try {
        const generated = await generateRoute(routeInput, {
          onProgress: (progress) => {
            send({ type: "progress", progress });
          },
        });

        const stored: StoredRoute = {
          ...generated,
          bikeType: routeInput.bikeType,
          direction: routeInput.direction,
          profile: routeInput.profile,
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
            generated.geojson.properties.loopEntry &&
            typeof generated.geojson.properties.loopEntry === "object"
              ? (generated.geojson.properties.loopEntry as StoredRoute["loopEntry"])
              : undefined,
        };

        send({ type: "complete", route: stored });
      } catch (error) {
        console.error(error);
        send({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Błąd generowania trasy",
        });
      } finally {
        controller.close();
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
