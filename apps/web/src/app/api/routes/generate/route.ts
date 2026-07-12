import { generateRoute } from "@loopforge/generator";
import type {
  GenerateRouteRequest,
  RouteGenerationStreamEvent,
  StoredRoute,
} from "@loopforge/osm-types";
import { saveRoute } from "@/lib/routes-store";

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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RouteGenerationStreamEvent) => {
        controller.enqueue(sseChunk(event));
      };

      try {
        const generated = await generateRoute(body, {
          onProgress: (progress) => {
            send({ type: "progress", progress });
          },
        });

        const stored: StoredRoute = {
          ...generated,
          bikeType: body.bikeType,
          direction: body.direction,
          profile: body.profile,
          avoidAsphalt: body.avoidAsphalt,
          approachEnabled: body.approachEnabled,
          approachDistanceKm: body.approachEnabled
            ? body.approachDistanceKm
            : undefined,
          start: body.start,
          loopEntry:
            body.approachEnabled &&
            generated.geojson.properties.loopEntry &&
            typeof generated.geojson.properties.loopEntry === "object"
              ? (generated.geojson.properties.loopEntry as StoredRoute["loopEntry"])
              : undefined,
        };

        await saveRoute(stored);
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
