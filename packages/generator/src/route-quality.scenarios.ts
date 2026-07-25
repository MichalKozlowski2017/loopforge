import type {
  BikeType,
  Direction,
  GenerateRouteRequest,
  LatLng,
  RideProfile,
  RouteGenerationProgress,
} from "@loopforge/osm-types";
import {
  getRideProfileLabel,
  getRideProfileOptions,
  RIDE_PROFILE_OPTIONS,
} from "@loopforge/osm-types";
import { parseGpxTrackCoordinates } from "@loopforge/gpx";
import { generateRoute } from "./index";
import {
  auditGeneratedRoute,
  auditLongEdgesWithRouter,
  auditRouteGeometry,
  formatRouteQualityReport,
  type RouteQualityAudit,
} from "./route-quality";
import {
  fetchRouteBetweenPoints,
  getBrouterConfig,
} from "@loopforge/brouter";
import { startInMetroArea } from "./urban-context";

/** Rural Mazowsze — gravel / MTB / general. */
export const START_RURAL: LatLng = { lat: 52.39225, lng: 21.34062 };

/** Warsaw — Ochota / Filtry edge: still metro, less one-way maze than Śródmieście. */
export const START_URBAN: LatLng = { lat: 52.2118, lng: 20.9815 };

const APPROACH_DISTANCE_KM = 8;

/** Distances used by the geo stress matrix (km). Override via LOOPFORGE_STRESS_DISTANCES. */
export const STRESS_DISTANCES_KM = [20, 35, 60] as const;

export type StressStart = {
  id: string;
  label: string;
  start: LatLng;
};

export type StressPlacesMode = "pool" | "random" | "mixed";

/**
 * Named Polish starts spanning cities, coast, lakes, mountains, and rural fabric.
 * Stress matrix shuffles this pool (and/or adds fully random PL points).
 */
export const STRESS_START_POOL: StressStart[] = [
  { id: "waw-ochota", label: "Warszawa Ochota", start: START_URBAN },
  { id: "waw-bialoleka", label: "Warszawa Białołęka", start: { lat: 52.3325, lng: 21.0085 } },
  { id: "krk-krowodrza", label: "Kraków Krowodrza", start: { lat: 50.0785, lng: 19.9235 } },
  { id: "krk-podgorze", label: "Kraków Podgórze", start: { lat: 50.0345, lng: 19.9548 } },
  { id: "maz-tluszcz", label: "Mazowsze Tłuszcz", start: START_RURAL },
  { id: "wro-krzyki", label: "Wrocław Krzyki", start: { lat: 51.0742, lng: 17.0385 } },
  { id: "gdn-oliwa", label: "Gdańsk Oliwa", start: { lat: 54.4108, lng: 18.5622 } },
  { id: "sopot", label: "Sopot", start: { lat: 54.4416, lng: 18.5601 } },
  { id: "poz-jezyce", label: "Poznań Jeżyce", start: { lat: 52.4165, lng: 16.8905 } },
  { id: "lodz-polesie", label: "Łódź Polesie", start: { lat: 51.7765, lng: 19.4285 } },
  { id: "kat-ligota", label: "Katowice Ligota", start: { lat: 50.2315, lng: 18.9755 } },
  { id: "lublin-slawin", label: "Lublin Sławin", start: { lat: 51.2655, lng: 22.5135 } },
  { id: "bialystok-antoniuk", label: "Białystok Antoniuk", start: { lat: 53.1475, lng: 23.1345 } },
  { id: "szczecin-pogodno", label: "Szczecin Pogodno", start: { lat: 53.4375, lng: 14.5255 } },
  { id: "bydgoszcz-fordon", label: "Bydgoszcz Fordon", start: { lat: 53.1565, lng: 18.1455 } },
  { id: "torun-bielany", label: "Toruń Bielany", start: { lat: 53.0285, lng: 18.5755 } },
  { id: "olsztyn-kortowo", label: "Olsztyn Kortowo", start: { lat: 53.7465, lng: 20.4565 } },
  { id: "rzeszow-baranowka", label: "Rzeszów Baranówka", start: { lat: 50.0525, lng: 21.9785 } },
  { id: "kielce-swietokrzyskie", label: "Kielce", start: { lat: 50.8705, lng: 20.6275 } },
  { id: "beskid-andrychow", label: "Beskid Andrychów", start: { lat: 49.8558, lng: 19.3392 } },
  { id: "zakopane-gubalowka", label: "Zakopane Gubałówka", start: { lat: 49.3105, lng: 19.9485 } },
  { id: "bieszczady-ujscie", label: "Bieszczady Ustrzyki Dln.", start: { lat: 49.4305, lng: 22.5935 } },
  { id: "sudety-kudowa", label: "Sudety Kudowa-Zdrój", start: { lat: 50.4385, lng: 16.2435 } },
  { id: "pomorze-kartuzy", label: "Pomorze Kartuzy", start: { lat: 54.3342, lng: 18.2015 } },
  { id: "kaszuby-stezyca", label: "Kaszuby Stężyca", start: { lat: 54.2035, lng: 17.9485 } },
  { id: "mazury-mikolajki", label: "Mazury Mikołajki", start: { lat: 53.8025, lng: 21.5705 } },
  { id: "podlasie-bialowieza", label: "Podlasie Białowieża", start: { lat: 52.7005, lng: 23.8705 } },
  { id: "lubuskie-miedzyrzecz", label: "Lubuskie Międzyrzecz", start: { lat: 52.4455, lng: 15.5785 } },
  { id: "wielkopolska-gniezno", label: "Wielkopolska Gniezno", start: { lat: 52.5355, lng: 17.5955 } },
  { id: "opolskie-nysa", label: "Opolskie Nysa", start: { lat: 50.4735, lng: 17.3335 } },
  { id: "swietokrzyski-checiny", label: "Świętokrzyskie Chęciny", start: { lat: 50.8005, lng: 20.4625 } },
  { id: "jura-ojcow", label: "Jura Ojców", start: { lat: 50.2155, lng: 19.8255 } },
];

/** Coarse Poland outline [lng, lat] — reject random samples outside the country. */
const POLAND_OUTLINE: Array<[number, number]> = [
  [14.12, 53.95],
  [14.45, 53.4],
  [14.6, 52.75],
  [14.9, 51.85],
  [15.05, 51.05],
  [14.85, 50.85],
  [15.55, 50.55],
  [16.35, 50.45],
  [16.85, 50.25],
  [17.55, 50.15],
  [18.35, 49.95],
  [19.05, 49.45],
  [19.65, 49.25],
  [20.15, 49.35],
  [20.75, 49.25],
  [21.55, 49.2],
  [22.55, 49.15],
  [22.85, 49.55],
  [23.55, 50.15],
  [24.05, 50.55],
  [24.05, 50.95],
  [23.75, 51.55],
  [23.55, 52.15],
  [23.75, 52.65],
  [23.95, 53.15],
  [23.55, 53.55],
  [22.85, 54.25],
  [21.55, 54.35],
  [19.85, 54.55],
  [18.85, 54.75],
  [18.15, 54.85],
  [16.55, 54.55],
  [15.55, 54.15],
  [14.65, 53.95],
  [14.12, 53.95],
];

/** Soft hubs used to bias random PL samples toward inhabited / rideable areas. */
const POLAND_RANDOM_HUBS: Array<{
  lat: number;
  lng: number;
  jitterDeg: number;
  weight: number;
}> = [
  // Cities / dense fabric (higher weight, tight jitter)
  { lat: 52.23, lng: 21.01, jitterDeg: 0.22, weight: 4 }, // Warszawa
  { lat: 50.06, lng: 19.94, jitterDeg: 0.18, weight: 3 }, // Kraków
  { lat: 51.11, lng: 17.04, jitterDeg: 0.18, weight: 3 }, // Wrocław
  { lat: 54.37, lng: 18.61, jitterDeg: 0.2, weight: 3 }, // Gdańsk
  { lat: 52.41, lng: 16.93, jitterDeg: 0.18, weight: 3 }, // Poznań
  { lat: 51.77, lng: 19.46, jitterDeg: 0.18, weight: 2 }, // Łódź
  { lat: 50.26, lng: 19.02, jitterDeg: 0.16, weight: 2 }, // Katowice
  { lat: 51.25, lng: 22.57, jitterDeg: 0.16, weight: 2 }, // Lublin
  { lat: 53.13, lng: 23.16, jitterDeg: 0.16, weight: 2 }, // Białystok
  { lat: 53.43, lng: 14.55, jitterDeg: 0.16, weight: 2 }, // Szczecin
  { lat: 53.12, lng: 18.01, jitterDeg: 0.16, weight: 2 }, // Bydgoszcz
  { lat: 53.01, lng: 18.6, jitterDeg: 0.14, weight: 1 }, // Toruń
  { lat: 53.78, lng: 20.49, jitterDeg: 0.18, weight: 2 }, // Olsztyn
  { lat: 50.04, lng: 22.0, jitterDeg: 0.16, weight: 1 }, // Rzeszów
  { lat: 50.87, lng: 20.63, jitterDeg: 0.14, weight: 1 }, // Kielce
  // Rideable countryside (lower weight)
  { lat: 52.4, lng: 21.35, jitterDeg: 0.35, weight: 1 }, // Mazowsze E
  { lat: 53.8, lng: 21.55, jitterDeg: 0.3, weight: 1 }, // Mazury
  { lat: 54.25, lng: 18.1, jitterDeg: 0.28, weight: 1 }, // Kaszuby
  { lat: 50.8, lng: 16.3, jitterDeg: 0.28, weight: 1 }, // Sudety foothills
  { lat: 49.9, lng: 19.0, jitterDeg: 0.25, weight: 1 }, // Beskid
];

const DIRECTIONS: Direction[] = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
];

/** Base loop lengths matching sensible UI defaults per bike × profile. */
const DISTANCE_KM: Record<BikeType, Record<RideProfile, number>> = {
  gravel: { flow: 25, technical: 25, fast: 30 },
  road: { flow: 20, technical: 18, fast: 25 },
  mtb: { flow: 22, technical: 20, fast: 25 },
  general: { flow: 25, technical: 25, fast: 25 },
};

export type LiveRouteScenario = {
  id: string;
  label: string;
  request: GenerateRouteRequest;
  /** Urban geometry context for teleport thresholds. */
  urban?: boolean;
  /** Optional place tag for stress matrix reporting. */
  placeId?: string;
};

export type LiveRouteMatrix = "full" | "core" | "stress" | "stress-full";

type ToggleCombo = {
  avoidAsphalt: boolean;
  preferQuietRoutes: boolean;
  approachEnabled: boolean;
};

function supportsAvoidAsphalt(bikeType: BikeType): boolean {
  return bikeType === "gravel" || bikeType === "mtb";
}

function toggleCombos(bikeType: BikeType): ToggleCombo[] {
  const avoidStates = supportsAvoidAsphalt(bikeType) ? [false, true] : [false];
  const quietStates = [false, true];
  const approachStates = [false, true];
  const out: ToggleCombo[] = [];
  for (const avoidAsphalt of avoidStates) {
    for (const preferQuietRoutes of quietStates) {
      for (const approachEnabled of approachStates) {
        out.push({ avoidAsphalt, preferQuietRoutes, approachEnabled });
      }
    }
  }
  return out;
}

function scenarioId(
  bikeType: BikeType,
  profile: RideProfile,
  toggles: ToggleCombo,
): string {
  const parts: string[] = [bikeType, profile];
  if (toggles.avoidAsphalt) parts.push("avoid");
  if (toggles.preferQuietRoutes) parts.push("quiet");
  if (toggles.approachEnabled) parts.push("approach");
  return parts.join("-");
}

function scenarioLabel(
  bikeType: BikeType,
  profile: RideProfile,
  toggles: ToggleCombo,
): string {
  const bikeLabel =
    bikeType === "road"
      ? "Szosa"
      : bikeType === "mtb"
        ? "MTB"
        : bikeType === "general"
          ? "Ogólny"
          : "Gravel";
  const profileLabel = getRideProfileLabel(bikeType, profile) ?? profile;
  const flags: string[] = [];
  if (toggles.avoidAsphalt) flags.push("unikaj asfaltu");
  if (toggles.preferQuietRoutes) flags.push("spokojne");
  if (toggles.approachEnabled) flags.push("dojazd");
  return flags.length > 0
    ? `${bikeLabel} · ${profileLabel} · ${flags.join(" · ")}`
    : `${bikeLabel} · ${profileLabel}`;
}

function buildScenario(
  bikeType: BikeType,
  profile: RideProfile,
  toggles: ToggleCombo,
  index: number,
  overrides?: {
    start?: LatLng;
    distanceKm?: number;
    place?: StressStart;
    urban?: boolean;
  },
): LiveRouteScenario {
  const start =
    overrides?.start ?? (bikeType === "road" ? START_URBAN : START_RURAL);
  const urban =
    overrides?.urban ??
    (overrides?.start ? startInMetroArea(start) : bikeType === "road");

  let distanceKm = overrides?.distanceKm ?? DISTANCE_KM[bikeType][profile];
  // Keep approach runs closer to target length / wall-clock — but not when
  // stress matrix pins an explicit distance (20 / 35 / 60).
  if (toggles.approachEnabled && overrides?.distanceKm == null) {
    distanceKm = Math.max(15, Math.round(distanceKm * 0.8));
  }

  const idBase = scenarioId(bikeType, profile, toggles);
  const labelBase = scenarioLabel(bikeType, profile, toggles);
  const place = overrides?.place;
  const id = place ? `${idBase}-${place.id}-${distanceKm}` : idBase;
  const label = place
    ? `${labelBase} · ${place.label} · ${distanceKm} km`
    : labelBase;
  const direction = DIRECTIONS[index % DIRECTIONS.length]!;

  return {
    id,
    label,
    urban,
    placeId: place?.id,
    request: {
      start,
      bikeType,
      profile,
      distanceKm,
      direction,
      avoidAsphalt: supportsAvoidAsphalt(bikeType)
        ? toggles.avoidAsphalt
        : undefined,
      preferQuietRoutes: toggles.preferQuietRoutes || undefined,
      approachEnabled: toggles.approachEnabled || undefined,
      approachDistanceKm: toggles.approachEnabled
        ? APPROACH_DISTANCE_KM
        : undefined,
    },
  };
}

/** Mulberry32 — deterministic "random" picks for stress starts. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseDistanceList(raw: string | undefined): number[] {
  if (!raw?.trim()) return [...STRESS_DISTANCES_KM];
  const parsed = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 10 && n <= 200);
  return parsed.length > 0 ? parsed : [...STRESS_DISTANCES_KM];
}

function parsePlacesMode(raw: string | undefined): StressPlacesMode {
  const v = (raw ?? "mixed").trim().toLowerCase();
  if (v === "pool" || v === "random" || v === "mixed") return v;
  return "mixed";
}

/** `random` / `now` → time-based seed; otherwise positive int (default 1). */
export function parseStressSeed(raw: string | undefined, fallback = 1): number {
  const v = raw?.trim().toLowerCase();
  if (v === "random" || v === "now") {
    return (Date.now() ^ (Math.floor(Math.random() * 1e9) >>> 0)) >>> 0 || 1;
  }
  return parsePositiveInt(raw, fallback);
}

function pointInPoland(lat: number, lng: number): boolean {
  // Ray cast on POLAND_OUTLINE (lng=x, lat=y).
  let inside = false;
  for (let i = 0, j = POLAND_OUTLINE.length - 1; i < POLAND_OUTLINE.length; j = i++) {
    const [xi, yi] = POLAND_OUTLINE[i]!;
    const [xj, yj] = POLAND_OUTLINE[j]!;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function formatRandomStart(start: LatLng, index: number): StressStart {
  const lat = Math.round(start.lat * 10000) / 10000;
  const lng = Math.round(start.lng * 10000) / 10000;
  return {
    id: `rnd-${lat}-${lng}`,
    label: `PL losowy #${index + 1} (${lat}°N ${lng}°E)`,
    start: { lat, lng },
  };
}

/**
 * Seeded random point inside Poland, biased toward regional hubs so samples
 * land near roads more often than pure bbox noise.
 */
export function randomPolandStart(
  rand: () => number,
  maxAttempts = 40,
): LatLng {
  const totalWeight = POLAND_RANDOM_HUBS.reduce((s, h) => s + h.weight, 0);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let pick = rand() * totalWeight;
    let hub = POLAND_RANDOM_HUBS[0]!;
    for (const candidate of POLAND_RANDOM_HUBS) {
      pick -= candidate.weight;
      if (pick <= 0) {
        hub = candidate;
        break;
      }
    }
    const lat = hub.lat + (rand() * 2 - 1) * hub.jitterDeg;
    const lng = hub.lng + (rand() * 2 - 1) * hub.jitterDeg;
    if (pointInPoland(lat, lng)) return { lat, lng };
  }
  // Fallback: known rural Mazowsze if rejection sampling fails.
  return { ...START_RURAL };
}

function shuffleInPlace<T>(items: T[], rand: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

/**
 * Pick stress starts for the geo matrix.
 *
 * - `pool` — shuffle named Polish places
 * - `random` — fully random points across PL (hub-biased)
 * - `mixed` (default) — ~⅓ named + rest random PL
 */
export function pickStressStarts(
  count = 3,
  seed = 1,
  pool: StressStart[] = STRESS_START_POOL,
  mode: StressPlacesMode = "mixed",
): StressStart[] {
  const rand = mulberry32(seed);
  const n = Math.max(1, count);

  if (mode === "pool") {
    return shuffleInPlace([...pool], rand).slice(0, Math.min(n, pool.length));
  }

  if (mode === "random") {
    const out: StressStart[] = [];
    const seen = new Set<string>();
    let guard = 0;
    while (out.length < n && guard < n * 20) {
      guard += 1;
      const start = formatRandomStart(randomPolandStart(rand), out.length);
      if (seen.has(start.id)) continue;
      seen.add(start.id);
      out.push(start);
    }
    return out;
  }

  // mixed: at least one named place when count≥2, rest random across PL
  const namedCount = n <= 1 ? 0 : Math.max(1, Math.round(n / 3));
  const named = shuffleInPlace([...pool], rand).slice(
    0,
    Math.min(namedCount, pool.length),
  );
  const out: StressStart[] = [...named];
  const seen = new Set(out.map((s) => s.id));
  let guard = 0;
  while (out.length < n && guard < n * 20) {
    guard += 1;
    const start = formatRandomStart(randomPolandStart(rand), out.length);
    if (seen.has(start.id)) continue;
    seen.add(start.id);
    out.push(start);
  }
  return shuffleInPlace(out, rand);
}

/**
 * Full product UI matrix: every bike × podprofil × toggles visible in the form.
 *
 * Count: gravel 24 + mtb 24 + road 12 + general 12 = 72
 */
export function buildLiveRouteScenarios(): LiveRouteScenario[] {
  const scenarios: LiveRouteScenario[] = [];
  let index = 0;
  for (const bikeType of Object.keys(RIDE_PROFILE_OPTIONS) as BikeType[]) {
    for (const option of getRideProfileOptions(bikeType)) {
      for (const toggles of toggleCombos(bikeType)) {
        scenarios.push(buildScenario(bikeType, option.value, toggles, index));
        index += 1;
      }
    }
  }
  return scenarios;
}

/**
 * Compact smoke set: one row per bike × profile with typical default toggles.
 */
export function buildCoreRouteScenarios(): LiveRouteScenario[] {
  const cores: Array<{
    bikeType: BikeType;
    profile: RideProfile;
    avoidAsphalt?: boolean;
    preferQuietRoutes?: boolean;
  }> = [
    { bikeType: "gravel", profile: "flow", avoidAsphalt: true },
    { bikeType: "gravel", profile: "technical", avoidAsphalt: true },
    { bikeType: "gravel", profile: "fast", avoidAsphalt: true },
    { bikeType: "road", profile: "fast" },
    { bikeType: "road", profile: "flow", preferQuietRoutes: true },
    { bikeType: "road", profile: "technical", preferQuietRoutes: true },
    { bikeType: "mtb", profile: "flow", avoidAsphalt: true },
    { bikeType: "mtb", profile: "technical", avoidAsphalt: true },
    { bikeType: "mtb", profile: "fast", avoidAsphalt: true },
    { bikeType: "general", profile: "flow" },
    { bikeType: "general", profile: "technical", avoidAsphalt: true },
    { bikeType: "general", profile: "fast" },
  ];

  return cores.map((core, index) =>
    buildScenario(
      core.bikeType,
      core.profile,
      {
        avoidAsphalt: Boolean(core.avoidAsphalt),
        preferQuietRoutes: Boolean(core.preferQuietRoutes),
        approachEnabled: false,
      },
      index,
    ),
  );
}

export type StressMatrixOptions = {
  /** When true, expand every UI toggle combo (72×starts×distances). */
  includeAllToggles?: boolean;
  startCount?: number;
  distancesKm?: number[];
  seed?: number;
  /** How to choose starts: named pool, random PL, or mix (default). */
  placesMode?: StressPlacesMode;
};

/**
 * Geo stress matrix: each option × N starts × M distances.
 *
 * Default (`stress`): 12 core bike×profile rows × 3 starts × 3 distances = 108.
 * Full (`stress-full`): all 72 UI combos × 3 × 3 = 648 (overnight).
 *
 * Starts default to `mixed` (named PL towns + random points across Poland).
 */
export function buildStressRouteScenarios(
  options: StressMatrixOptions = {},
): LiveRouteScenario[] {
  const includeAllToggles = Boolean(options.includeAllToggles);
  const startCount = options.startCount ?? 3;
  const distancesKm = options.distancesKm ?? [...STRESS_DISTANCES_KM];
  const seed = options.seed ?? 1;
  const placesMode = options.placesMode ?? "mixed";
  const starts = pickStressStarts(
    startCount,
    seed,
    STRESS_START_POOL,
    placesMode,
  );
  const bases = includeAllToggles
    ? buildLiveRouteScenarios()
    : buildCoreRouteScenarios();

  const out: LiveRouteScenario[] = [];
  let index = 0;
  for (const base of bases) {
    const toggles: ToggleCombo = {
      avoidAsphalt: Boolean(base.request.avoidAsphalt),
      preferQuietRoutes: Boolean(base.request.preferQuietRoutes),
      approachEnabled: Boolean(base.request.approachEnabled),
    };
    for (const place of starts) {
      for (const distanceKm of distancesKm) {
        out.push(
          buildScenario(
            base.request.bikeType,
            base.request.profile ?? "flow",
            toggles,
            index,
            {
              start: place.start,
              distanceKm,
              place,
              urban: startInMetroArea(place.start),
            },
          ),
        );
        index += 1;
      }
    }
  }
  return out;
}

/** Default: full UI matrix (72). Use LOOPFORGE_MATRIX=core for the 12 smoke rows. */
export const LIVE_ROUTE_SCENARIOS: LiveRouteScenario[] =
  buildLiveRouteScenarios();

export const LIVE_ROUTE_SCENARIOS_CORE: LiveRouteScenario[] =
  buildCoreRouteScenarios();

function stressOptionsFromEnv(): StressMatrixOptions {
  return {
    startCount: parsePositiveInt(process.env.LOOPFORGE_STRESS_STARTS, 3),
    distancesKm: parseDistanceList(process.env.LOOPFORGE_STRESS_DISTANCES),
    seed: parseStressSeed(process.env.LOOPFORGE_STRESS_SEED, 1),
    placesMode: parsePlacesMode(process.env.LOOPFORGE_STRESS_PLACES),
  };
}

export function resolveLiveRouteScenarios(
  matrix: LiveRouteMatrix = "full",
): LiveRouteScenario[] {
  if (matrix === "core") return LIVE_ROUTE_SCENARIOS_CORE;
  if (matrix === "stress") {
    return buildStressRouteScenarios(stressOptionsFromEnv());
  }
  if (matrix === "stress-full") {
    return buildStressRouteScenarios({
      ...stressOptionsFromEnv(),
      includeAllToggles: true,
    });
  }
  return LIVE_ROUTE_SCENARIOS;
}

/** Max wall-clock for a single scenario before it counts as FAIL (ms). */
export function maxGenerationMsFromEnv(): number {
  return parsePositiveInt(process.env.LOOPFORGE_MAX_GEN_MS, 90_000);
}

export type ScenarioRunResult = {
  scenario: LiveRouteScenario;
  ok: boolean;
  error?: string;
  distanceKm?: number;
  gpxPoints?: number;
  geometryAudit?: RouteQualityAudit;
  gpxAudit?: RouteQualityAudit;
  durationMs: number;
  gpx?: string;
};

export type RunLiveRouteScenarioOptions = {
  onProgress?: (progress: RouteGenerationProgress) => void;
  onPhase?: (
    phase: "generate" | "audit-geometry" | "audit-gpx" | "audit-onpath",
  ) => void;
  /** Override SLA; default from LOOPFORGE_MAX_GEN_MS (120s). */
  maxGenerationMs?: number;
};

/**
 * Generate one loop on the configured BRouter, then audit geometry, access
 * tags, on-network snap, densified GPX, and long-edge BRouter re-checks.
 */
export async function runLiveRouteScenario(
  scenario: LiveRouteScenario,
  options: RunLiveRouteScenarioOptions = {},
): Promise<ScenarioRunResult> {
  const started = Date.now();
  const maxGenMs = options.maxGenerationMs ?? maxGenerationMsFromEnv();
  const approach = Boolean(scenario.request.approachEnabled);
  try {
    options.onPhase?.("generate");
    const route = await generateRoute(scenario.request, {
      onProgress: options.onProgress,
    });
    const durationMs = Date.now() - started;
    const coordinates = route.geojson.geometry.coordinates as [
      number,
      number,
    ][];
    const gpxCoords = parseGpxTrackCoordinates(route.gpx);
    const segments = route.segments ?? [];
    const network =
      route.networkCoordinates && route.networkCoordinates.length >= 2
        ? route.networkCoordinates
        : coordinates;

    const auditOpts = {
      targetDistanceKm: scenario.request.distanceKm,
      actualDistanceKm: route.metrics.loopDistanceKm ?? route.metrics.distanceKm,
      allowApproachMirror: approach,
      geometryContext: {
        start: scenario.request.start,
        urban: scenario.urban,
      },
      networkCoordinates: network,
      maxPointDistanceM: scenario.urban ? 40 : 35,
    };

    options.onPhase?.("audit-geometry");
    const geometryAudit = auditGeneratedRoute(coordinates, segments, {
      ...auditOpts,
      // Approach GPX is dojazd + loop + return: spur/backtrack of the full
      // polyline are dominated by the intentional out-and-back. Loop quality
      // was already gated inside generateRoute; here continuity + on-path matter.
      maxSpurShare: approach ? 1 : scenario.urban ? 0.14 : 0.08,
      maxBacktrack: approach ? 1 : scenario.urban ? 0.2 : 0.09,
      maxMirroredPrefixM: approach ? 25_000 : 800,
      maxOffPathShare: 0.025,
      maxOffPathM: scenario.urban ? 120 : 80,
    });

    options.onPhase?.("audit-gpx");
    // Densified GPX (~5 m) wildly inflates spur/backtrack — only enforce
    // continuity + on-path (and allow dojazd mirror when approach is on).
    const gpxAudit = auditRouteGeometry(gpxCoords, {
      ...auditOpts,
      actualDistanceKm: undefined,
      maxSpurShare: 1,
      maxBacktrack: 1,
      maxMirroredPrefixM: approach ? 25_000 : 800,
      failOnRemainingSpurs: false,
      maxOffPathShare: 0.03,
      maxOffPathM: scenario.urban ? 150 : 100,
    });

    options.onPhase?.("audit-onpath");
    const brouterConfig = getBrouterConfig();
    const edgeFindings = brouterConfig
      ? await auditLongEdgesWithRouter(
          coordinates,
          async (from, to) => {
            const leg = await fetchRouteBetweenPoints(brouterConfig, {
              from,
              to,
              bikeType: scenario.request.bikeType,
              rideProfile: scenario.request.profile,
              skipGpx: true,
            });
            return leg.coordinates;
          },
          {
            minEdgeM: scenario.urban ? 55 : 70,
            maxEdges: 6,
          },
        )
      : [];

    const geometryWithEdges: RouteQualityAudit = {
      ...geometryAudit,
      findings: [...geometryAudit.findings, ...edgeFindings],
      ok:
        geometryAudit.ok &&
        edgeFindings.every((f) => f.severity !== "error"),
    };

    const tooSlow = durationMs > maxGenMs;
    const ok =
      geometryWithEdges.ok &&
      gpxAudit.ok &&
      gpxCoords.length >= 50 &&
      !tooSlow;

    return {
      scenario,
      ok,
      distanceKm: route.metrics.distanceKm,
      gpxPoints: gpxCoords.length,
      geometryAudit: geometryWithEdges,
      gpxAudit,
      durationMs,
      gpx: route.gpx,
      error: ok
        ? undefined
        : [
            tooSlow
              ? `SLOW_GENERATION: ${Math.round(durationMs / 1000)}s > limit ${Math.round(maxGenMs / 1000)}s`
              : null,
            !geometryWithEdges.ok
              ? `geometry:\n${formatRouteQualityReport(geometryWithEdges)}`
              : null,
            !gpxAudit.ok
              ? `gpx:\n${formatRouteQualityReport(gpxAudit)}`
              : null,
            gpxCoords.length < 50
              ? `gpx too few points (${gpxCoords.length})`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
    };
  } catch (err) {
    return {
      scenario,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    };
  }
}

export function scenarioDisplayName(scenario: LiveRouteScenario): string {
  const profile = getRideProfileLabel(
    scenario.request.bikeType,
    scenario.request.profile,
  );
  const base = profile
    ? `${scenario.request.bikeType}/${profile}`
    : scenario.label;
  const flags: string[] = [];
  if (scenario.request.avoidAsphalt) flags.push("A");
  if (scenario.request.preferQuietRoutes) flags.push("Q");
  if (scenario.request.approachEnabled) flags.push("D");
  const flagStr = flags.length > 0 ? ` +${flags.join("")}` : "";
  const place =
    scenario.placeId != null
      ? ` · ${scenario.placeId} · ${scenario.request.distanceKm}km`
      : "";
  return `${base}${flagStr}${place}`;
}
