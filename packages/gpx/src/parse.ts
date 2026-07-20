/**
 * Minimal GPX track parser for quality audits (trkpt lat/lon).
 */
export function parseGpxTrackCoordinates(gpxXml: string): [number, number][] {
  const coords: [number, number][] = [];
  const re =
    /<trkpt\b[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>|<trkpt\b[^>]*\blon="([^"]+)"[^>]*\blat="([^"]+)"[^>]*>/gi;

  for (const match of gpxXml.matchAll(re)) {
    const lat = Number(match[1] ?? match[4]);
    const lng = Number(match[2] ?? match[3]);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
    ) {
      coords.push([lng, lat]);
    }
  }

  return coords;
}
