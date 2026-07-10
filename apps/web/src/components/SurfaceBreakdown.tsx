import {
  colorForBreakdownLabel,
  type SurfaceBreakdownItem,
} from "@loopforge/osm-types";

type BreakdownInput =
  | SurfaceBreakdownItem[]
  | Record<string, number>;

function normalizeBreakdown(breakdown: BreakdownInput): SurfaceBreakdownItem[] {
  if (Array.isArray(breakdown)) {
    return breakdown;
  }

  return Object.entries(breakdown)
    .map(([label, share]) => ({
      label,
      share,
      color: colorForBreakdownLabel(label),
    }))
    .sort((a, b) => b.share - a.share);
}

interface SurfaceBreakdownProps {
  breakdown: BreakdownInput;
}

export function SurfaceBreakdown({ breakdown }: SurfaceBreakdownProps) {
  const entries = normalizeBreakdown(breakdown).filter(
    (item) => item.share > 0.01,
  );

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-zinc-200">Skład nawierzchni</h3>
      <ul className="space-y-1.5">
        {entries.map((item) => (
          <li key={item.label}>
            <div className="mb-0.5 flex justify-between text-xs text-zinc-400">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-3 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                {item.label}
              </span>
              <span>{(item.share * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${item.share * 100}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
