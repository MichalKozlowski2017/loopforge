export type SurfaceCategory =
  | "asphalt"
  | "cycleway"
  | "gravel"
  | "compacted"
  | "dirt"
  | "path"
  | "forest"
  | "residential"
  | "unknown";

export interface SurfaceStyle {
  category: SurfaceCategory;
  label: string;
  color: string;
  /** MapLibre line-dasharray — solid = [1, 0] */
  dash: number[];
}

const SURFACE_TAG_COLORS: Record<string, { label: string; color: string; category: SurfaceCategory }> = {
  asphalt: { label: "Asfalt", color: "#94a3b8", category: "asphalt" },
  paved: { label: "Utwardzona", color: "#94a3b8", category: "asphalt" },
  concrete: { label: "Beton", color: "#cbd5e1", category: "asphalt" },
  gravel: { label: "Szuter / gravel", color: "#f59e0b", category: "gravel" },
  fine_gravel: { label: "Drobny szuter", color: "#fbbf24", category: "gravel" },
  compacted: { label: "Utwardzony szuter", color: "#eab308", category: "compacted" },
  unpaved: { label: "Nieutwardzona", color: "#d97706", category: "gravel" },
  dirt: { label: "Ziemia", color: "#b45309", category: "dirt" },
  ground: { label: "Teren naturalny", color: "#92400e", category: "dirt" },
  grass: { label: "Trawa", color: "#65a30d", category: "path" },
  sand: { label: "Piasek", color: "#fcd34d", category: "gravel" },
  cobblestone: { label: "Kostka", color: "#78716c", category: "asphalt" },
  mud: { label: "Błoto", color: "#78350f", category: "dirt" },
};

const DASH: Record<SurfaceCategory, number[]> = {
  asphalt: [1, 0],
  cycleway: [1, 0],
  gravel: [2.5, 1.5],
  compacted: [4, 2],
  dirt: [1, 2],
  path: [1.5, 2],
  forest: [3, 2, 1, 2],
  residential: [1, 0],
  unknown: [2, 2],
};

function isForestContext(tags: Record<string, string>): boolean {
  const forest = tags.forest ?? tags.wood ?? tags.natural;
  if (forest === "yes" || forest === "wood" || forest === "forest") return true;
  return tags.landuse === "forest";
}

export function parseOsmTagString(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const part of raw.split(" ")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    tags[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return tags;
}

export function getSurfaceStyle(
  rawTags: Record<string, string | undefined>,
): SurfaceStyle {
  const tags = rawTags as Record<string, string>;
  const forest = isForestContext(tags);

  if (tags.route === "ferry") {
    return {
      category: "unknown",
      label: "Prom (ferry)",
      color: "#ef4444",
      dash: [4, 3],
    };
  }

  if (tags.surface && SURFACE_TAG_COLORS[tags.surface]) {
    const entry = SURFACE_TAG_COLORS[tags.surface];
    if (forest && (tags.highway === "path" || tags.highway === "track")) {
      return {
        category: "forest",
        label: "Leśna ścieżka",
        color: "#15803d",
        dash: DASH.forest,
      };
    }
    return { ...entry, dash: DASH[entry.category] };
  }

  if (tags.highway === "cycleway") {
    return {
      category: "cycleway",
      label: "Ścieżka rowerowa",
      color: "#22c55e",
      dash: DASH.cycleway,
    };
  }

  if (forest && (tags.highway === "path" || tags.highway === "track" || tags.highway === "bridleway")) {
    return {
      category: "forest",
      label: "Leśna ścieżka",
      color: "#15803d",
      dash: DASH.forest,
    };
  }

  if (tags.highway === "track") {
    return {
      category: "gravel",
      label: "Polna droga",
      color: "#f59e0b",
      dash: DASH.gravel,
    };
  }

  if (tags.highway === "footway") {
    return {
      category: "path",
      label: tags.footway === "crossing" ? "Przejście dla pieszych" : "Chodnik",
      color: "#22d3ee",
      dash: [1.5, 2],
    };
  }

  if (tags.highway === "pedestrian") {
    return {
      category: "path",
      label: "Strefa piesza",
      color: "#22d3ee",
      dash: [1.5, 2],
    };
  }

  if (tags.highway === "steps") {
    return {
      category: "path",
      label: "Schody",
      color: "#f87171",
      dash: [1, 1.5],
    };
  }

  if (tags.highway === "service") {
    return {
      category: "residential",
      label: "Droga dojazdowa",
      color: "#78716c",
      dash: DASH.residential,
    };
  }

  if (tags.highway === "unclassified") {
    return {
      category: "residential",
      label: "Droga nieklasyfikowana",
      color: "#a8a29e",
      dash: DASH.residential,
    };
  }

  if (tags.highway === "path" || tags.highway === "bridleway") {
    return {
      category: "path",
      label: "Ścieżka",
      color: "#84cc16",
      dash: DASH.path,
    };
  }

  if (tags.highway === "primary" || tags.highway === "secondary") {
    return {
      category: "asphalt",
      label: "Droga główna",
      color: "#64748b",
      dash: DASH.asphalt,
    };
  }

  if (tags.highway === "tertiary" || tags.highway === "residential" || tags.highway === "living_street") {
    return {
      category: "residential",
      label: "Droga lokalna",
      color: "#a8a29e",
      dash: DASH.residential,
    };
  }

  return {
    category: "unknown",
    label: tags.highway ? `Inne (${tags.highway})` : "Nieznane",
    color: "#c084fc",
    dash: DASH.unknown,
  };
}

export const SURFACE_LEGEND: Array<{
  label: string;
  color: string;
  category: SurfaceCategory;
  dash?: string;
}> = [
  { label: "Asfalt / droga główna", color: "#94a3b8", category: "asphalt" },
  { label: "Droga lokalna", color: "#a8a29e", category: "residential" },
  { label: "Ścieżka rowerowa", color: "#22c55e", category: "cycleway" },
  { label: "Szuter / gravel", color: "#f59e0b", category: "gravel", dash: "— —" },
  { label: "Utwardzony szuter", color: "#eab308", category: "compacted", dash: "—  —" },
  { label: "Ziemia / teren", color: "#b45309", category: "dirt", dash: "· · ·" },
  { label: "Ścieżka / trail", color: "#84cc16", category: "path", dash: "· ·" },
  { label: "Chodnik / strefa piesza", color: "#22d3ee", category: "path", dash: "· ·" },
  { label: "Schody", color: "#f87171", category: "path", dash: "· ·" },
  { label: "Leśna ścieżka", color: "#15803d", category: "forest", dash: "— · —" },
  { label: "Inne / brak tagu OSM", color: "#c084fc", category: "unknown", dash: "— —" },
];

export function colorForBreakdownLabel(label: string): string {
  const direct: Record<string, string> = {
    Asfalt: "#94a3b8",
    Utwardzona: "#94a3b8",
    Beton: "#cbd5e1",
    Chodnik: "#22d3ee",
    "Przejście dla pieszych": "#22d3ee",
    "Strefa piesza": "#22d3ee",
    Schody: "#f87171",
    "Droga dojazdowa": "#78716c",
    "Droga nieklasyfikowana": "#a8a29e",
    "Droga główna": "#64748b",
    "Droga lokalna": "#a8a29e",
    "Polna droga": "#f59e0b",
    "Szuter / gravel": "#f59e0b",
    "Drobny szuter": "#fbbf24",
    "Utwardzony szuter": "#eab308",
    Nieutwardzona: "#d97706",
    Ziemia: "#b45309",
    "Teren naturalny": "#92400e",
    Trawa: "#65a30d",
    Piasek: "#fcd34d",
    Kostka: "#78716c",
    Błoto: "#78350f",
    "Ścieżka rowerowa": "#22c55e",
    Ścieżka: "#84cc16",
    "Leśna ścieżka": "#15803d",
    Nieznane: "#c084fc",
  };

  if (direct[label]) return direct[label];
  if (label.startsWith("Inne (")) return "#c084fc";

  const exact = SURFACE_LEGEND.find((item) => item.label === label);
  if (exact) return exact.color;

  const partial = SURFACE_LEGEND.find((item) =>
    label.includes(item.label.split(" /")[0]),
  );
  return partial?.color ?? "#c084fc";
}
