import type { LatLng } from "@loopforge/osm-types";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildGpx(
  name: string,
  coordinates: [number, number][],
  start?: LatLng,
): string {
  const points = coordinates
    .map(
      ([lng, lat]) =>
        `        <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>`,
    )
    .join("\n");

  const metadata =
    start !== undefined
      ? `\n    <metadata>\n      <desc>Start: ${start.lat.toFixed(5)}, ${start.lng.toFixed(5)}</desc>\n    </metadata>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Loopforge" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>${metadata}
    <name>${escapeXml(name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}
