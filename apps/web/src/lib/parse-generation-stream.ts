import type {
  RouteGenerationProgress,
  RouteGenerationStreamEvent,
  StoredRoute,
} from "@loopforge/osm-types";

function parseSseChunk(chunk: string): RouteGenerationStreamEvent | null {
  const dataLine = chunk
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("data: "));
  if (!dataLine) return null;
  return JSON.parse(dataLine.slice(6)) as RouteGenerationStreamEvent;
}

export async function consumeGenerationStream(
  response: Response,
  onProgress: (progress: RouteGenerationProgress) => void,
): Promise<StoredRoute> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? "Nie udało się wygenerować trasy");
  }

  if (!response.body) {
    throw new Error("Brak odpowiedzi serwera");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let route: StoredRoute | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const event = parseSseChunk(chunk);
      if (event?.type === "progress") {
        onProgress(event.progress);
      } else if (event?.type === "complete") {
        route = event.route;
      } else if (event?.type === "error") {
        throw new Error(event.error);
      }

      boundary = buffer.indexOf("\n\n");
    }
  }

  if (!route) {
    throw new Error("Serwer nie zwrócił trasy");
  }

  return route;
}
