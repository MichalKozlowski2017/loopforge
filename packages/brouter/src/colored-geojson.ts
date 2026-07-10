import type { OsmTags, RouteMapGeoJson, RouteSegmentFeature } from "@loopforge/osm-types";
import { getSurfaceStyle, parseOsmTagString } from "@loopforge/osm-types";

function tagsKey(tags: Record<string, string>): string {
  return `${tags.highway ?? ""}|${tags.surface ?? ""}|${tags.forest ?? ""}|${tags.natural ?? ""}`;
}

function microToCoord(lon: string, lat: string): [number, number] {
  return [Number(lon) / 1_000_000, Number(lat) / 1_000_000];
}

export function buildColoredGeoJson(
  messages: string[][] | undefined,
): RouteMapGeoJson | null {
  if (!messages || messages.length < 2) return null;

  const features: RouteSegmentFeature[] = [];
  let currentCoords: [number, number][] = [];
  let currentTags: Record<string, string> = {};
  let currentKey = "";

  const flush = () => {
    if (currentCoords.length < 2) return;
    const style = getSurfaceStyle(currentTags as OsmTags);
    features.push({
      type: "Feature",
      properties: {
        surface: currentTags.surface ?? currentTags.highway ?? "nieznane",
        label: style.label,
        category: style.category,
        color: style.color,
        dash: style.dash,
        highway: currentTags.highway,
      },
      geometry: {
        type: "LineString",
        coordinates: currentCoords,
      },
    });
  };

  for (let i = 1; i < messages.length; i++) {
    const row = messages[i];
    const lon = row[0];
    const lat = row[1];
    const wayTags = row[9] ?? "";
    if (!lon || !lat || !wayTags) continue;

    const tags = parseOsmTagString(wayTags);
    const key = tagsKey(tags);
    const coord = microToCoord(lon, lat);

    if (key !== currentKey && currentCoords.length > 0) {
      flush();
      currentCoords = [currentCoords[currentCoords.length - 1], coord];
    } else {
      currentCoords.push(coord);
    }

    currentTags = tags;
    currentKey = key;
  }

  flush();

  if (features.length === 0) return null;

  return { type: "FeatureCollection", features };
}

export { getSurfaceStyle as colorForSurface } from "@loopforge/osm-types";
