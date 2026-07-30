/** Downsample a GeoJSON LineString for list thumbnails. */
export function downsampleCoordinates(
  coordinates: [number, number][],
  maxPoints: number,
): [number, number][] {
  if (coordinates.length <= maxPoints || maxPoints < 3) return coordinates;
  const out: [number, number][] = [];
  const last = coordinates.length - 1;
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i * last) / (maxPoints - 1));
    const point = coordinates[idx]!;
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) {
      out.push(point);
    }
  }
  return out;
}

export function extractPreviewPath(
  geojson: { geometry?: { coordinates?: unknown } } | null | undefined,
  maxPoints = 48,
): [number, number][] {
  const raw = geojson?.geometry?.coordinates;
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const coords: [number, number][] = [];
  for (const point of raw) {
    if (
      Array.isArray(point) &&
      typeof point[0] === "number" &&
      typeof point[1] === "number"
    ) {
      coords.push([point[0], point[1]]);
    }
  }
  return downsampleCoordinates(coords, maxPoints);
}

/** Fit lng/lat polyline into an SVG viewBox with padded equirectangular projection. */
export function previewPathToSvg(
  path: [number, number][],
  size = 100,
  padding = 10,
): { points: string; viewBox: string } | null {
  if (path.length < 2) return null;

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of path) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  const midLat = (minLat + maxLat) / 2;
  const cos = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const widthM = Math.max((maxLng - minLng) * cos, 1e-9);
  const heightM = Math.max(maxLat - minLat, 1e-9);
  const span = Math.max(widthM, heightM);
  const drawable = size - padding * 2;
  const scale = drawable / span;
  const offsetX = padding + (drawable - widthM * scale) / 2;
  const offsetY = padding + (drawable - heightM * scale) / 2;

  const points = path
    .map(([lng, lat]) => {
      const x = offsetX + (lng - minLng) * cos * scale;
      const y = offsetY + (maxLat - lat) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return { points, viewBox: `0 0 ${size} ${size}` };
}
