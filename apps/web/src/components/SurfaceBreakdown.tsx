interface SurfaceBreakdownProps {
  breakdown: Record<string, number>;
}

const LABELS: Record<string, string> = {
  asphalt: "Asfalt",
  paved: "Utwardzona",
  gravel: "Gravel",
  compacted: "Ubity szuter",
  dirt: "Ziemia",
  ground: "Teren",
  cycleway: "Ścieżka row.",
  track: "Polna droga",
  unknown: "Nieznane",
};

export function SurfaceBreakdown({ breakdown }: SurfaceBreakdownProps) {
  const entries = Object.entries(breakdown)
    .filter(([, value]) => value > 0.01)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-zinc-200">Nawierzchnia</h3>
      <ul className="space-y-1.5">
        {entries.map(([key, value]) => (
          <li key={key}>
            <div className="mb-0.5 flex justify-between text-xs text-zinc-400">
              <span>{LABELS[key] ?? key}</span>
              <span>{(value * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${value * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
