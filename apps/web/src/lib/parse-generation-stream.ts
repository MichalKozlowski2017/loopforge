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

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === "AbortError" || err.name === "TimeoutError";
  }
  if (err instanceof Error) {
    return (
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      /BodyStreamBuffer was aborted/i.test(err.message) ||
      /The operation was aborted/i.test(err.message)
    );
  }
  return false;
}

export async function consumeGenerationStream(
  response: Response,
  onProgress: (progress: RouteGenerationProgress) => void,
): Promise<{ route: StoredRoute; variants?: StoredRoute[] }> {
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
  let variants: StoredRoute[] | undefined;

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (isAbortError(err)) {
          throw new DOMException(
            "Generowanie przerwane (timeout lub anulowanie).",
            "TimeoutError",
          );
        }
        throw err;
      }
      const { done, value } = chunk;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const part = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const event = parseSseChunk(part);
        if (event?.type === "progress") {
          onProgress(event.progress);
        } else if (event?.type === "complete") {
          route = event.route;
          variants =
            event.variants && event.variants.length > 1
              ? event.variants
              : undefined;
        } else if (event?.type === "error") {
          throw new Error(event.error);
        }

        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released / aborted
    }
  }

  if (!route) {
    throw new Error("Serwer nie zwrócił trasy");
  }

  return { route, variants };
}
