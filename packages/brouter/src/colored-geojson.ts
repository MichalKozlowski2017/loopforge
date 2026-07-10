import type { OsmTags, RouteMapGeoJson, RouteSegmentFeature } from "@loopforge/osm-types";

const SURFACE_COLORS: Record<string, string> = {
  asphalt: "#94a3b8",
  paved: "#94a3b8",
  concrete: "#cbd5e1",
  gravel: "#f59e0b",
  compacted: "#eab308",
  fine_gravel: "#fbbf24",
  dirt: "#b45309",
  ground: "#92400e",
  grass: "#65a30d",
  sand: "#fcd34d",
  cobblestone: "#78716c",
  unpaved: "#d97706",
  mud: "#78350f",
};

function parseWayTags(raw: string): OsmTags {
  const tags: OsmTags = {};
  for (const part of raw.split(" ")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === "highway") tags.highway = value;
    if (key === "surface") tags.surface = value;
    if (key === "tracktype") tags.tracktype = value;
    if (key === "mtb:scale") tags["mtb:scale"] = value;
  }
  return tags;
}

export function colorForSurface(tags: OsmTags): string {
  if (tags.surface && SURFACE_COLORS[tags.surface]) {
    return SURFACE_COLORS[tags.surface];
  }
  if (tags.highway === "cycleway") return "#22c55e";
  if (tags.highway === "track") return "#f59e0b";
  if (tags.highway === "path" || tags.highway === "bridleway") return "#84cc16";
  if (tags.highway === "primary" || tags.highway === "secondary") {
    return "#64748b";
  }
  if (tags.highway === "tertiary" || tags.highway === "residential") {
    return "#a8a29e";
  }
  return "#c084fc";
}

function tagsKey(tags: OsmTags): string {
  return `${tags.highway ?? ""}|${tags.surface ?? ""}`;
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
  let currentTags: OsmTags = {};
  let currentKey = "";

  const flush = () => {
    if (currentCoords.length < 2) return;
    const label = currentTags.surface ?? currentTags.highway ?? "nieznane";
    features.push({
      type: "Feature",
      properties: {
        surface: label,
        color: colorForSurface(currentTags),
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

    const tags = parseWayTags(wayTags);
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

export const SURFACE_LEGEND = [
  { label: "Asfalt", color: "#94a3b8" },
  { label: "Ścieżka rowerowa", color: "#22c55e" },
  { label: "Gravel / szuter", color: "#f59e0b" },
  { label: "Utwardzony", color: "#eab308" },
  { label: "Ziemia / dirt", color: "#b45309" },
  { label: "Ścieżka / trail", color: "#84cc16" },
  { label: "Inne", color: "#c084fc" },
] as const;
