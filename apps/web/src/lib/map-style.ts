import type { StyleSpecification } from "maplibre-gl";

const LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const STABLE_VECTOR_TILES =
  "https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf";

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
};

let cachedStyle: StyleSpecification | null = null;

function patchOpenFreeMapStyle(style: StyleSpecification): StyleSpecification {
  const sources = style.sources as Record<
    string,
    { type?: string; url?: string; tiles?: string[]; minzoom?: number; maxzoom?: number }
  >;

  const openmaptiles = sources.openmaptiles;
  if (openmaptiles?.type === "vector" && openmaptiles.url) {
    delete openmaptiles.url;
    openmaptiles.tiles = [STABLE_VECTOR_TILES];
    openmaptiles.minzoom = openmaptiles.minzoom ?? 0;
    openmaptiles.maxzoom = openmaptiles.maxzoom ?? 14;
  }

  return style;
}

/**
 * Load Liberty style with a stable vector tile URL.
 * OpenFreeMap's default style resolves TileJSON to date-versioned paths that
 * occasionally fail in the browser (Failed to fetch 0). Using /planet/latest/
 * avoids that extra resolution step.
 */
export async function loadMapStyle(): Promise<StyleSpecification> {
  if (cachedStyle) return cachedStyle;

  try {
    const response = await fetch(LIBERTY_STYLE_URL, {
      cache: "force-cache",
    });
    if (!response.ok) {
      throw new Error(`OpenFreeMap style HTTP ${response.status}`);
    }

    const style = patchOpenFreeMapStyle(
      (await response.json()) as StyleSpecification,
    );
    cachedStyle = style;
    return style;
  } catch (error) {
    console.warn("[loopforge] OpenFreeMap style unavailable, using OSM fallback:", error);
    return FALLBACK_STYLE;
  }
}

export { FALLBACK_STYLE as osmFallbackMapStyle };
