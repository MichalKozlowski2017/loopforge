import { SURFACE_LEGEND } from "@/lib/surface-legend";

export function SurfaceLegend() {
  return (
    <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-zinc-700/80 bg-zinc-950/90 p-3 text-xs shadow-lg backdrop-blur">
      <p className="mb-2 font-medium text-zinc-300">Nawierzchnia</p>
      <ul className="space-y-1">
        {SURFACE_LEGEND.map((item) => (
          <li key={item.label} className="flex items-center gap-2 text-zinc-400">
            <span
              className="inline-block h-2.5 w-6 rounded-sm"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
