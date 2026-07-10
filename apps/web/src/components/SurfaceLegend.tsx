import { SURFACE_LEGEND } from "@loopforge/osm-types";

export function SurfaceLegend() {
  return (
    <div className="absolute bottom-4 left-4 z-10 max-h-[70vh] overflow-y-auto rounded-lg border border-zinc-700/80 bg-zinc-950/90 p-3 text-xs shadow-lg backdrop-blur">
      <p className="mb-1 font-medium text-zinc-200">Nawierzchnia na mapie</p>
      <p className="mb-2 text-[10px] leading-snug text-zinc-500">
        Kolory i wzorki linii z tagów OSM. Najedź na trasę po szczegóły.
      </p>
      <ul className="space-y-1.5">
        {SURFACE_LEGEND.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-zinc-400">
            <span
              className="inline-block h-1 w-7 shrink-0 rounded-full"
              style={{
                backgroundColor: item.color,
                backgroundImage: item.dash
                  ? `repeating-linear-gradient(90deg, ${item.color} 0 6px, transparent 6px 10px)`
                  : undefined,
              }}
            />
            <span className="flex-1">{item.label}</span>
            {item.dash ? (
              <span className="font-mono text-[10px] text-zinc-600">{item.dash}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
