import { colorForBreakdownLabel } from "@loopforge/osm-types";

interface SurfaceBreakdownProps {
  breakdown: Record<string, number>;
}

export function SurfaceBreakdown({ breakdown }: SurfaceBreakdownProps) {
  const entries = Object.entries(breakdown)
    .filter(([, value]) => value > 0.01)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-zinc-200">Skład nawierzchni</h3>
      <ul className="space-y-1.5">
        {entries.map(([label, value]) => {
          const color = colorForBreakdownLabel(label);
          return (
            <li key={label}>
              <div className="mb-0.5 flex justify-between text-xs text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-3 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                  {label}
                </span>
                <span>{(value * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${value * 100}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
