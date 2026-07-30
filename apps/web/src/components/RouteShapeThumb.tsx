import { previewPathToSvg } from "@/lib/route-shape-preview";

export function RouteShapeThumb({
  path,
  className = "",
  label = "Kształt trasy",
}: {
  path?: [number, number][];
  className?: string;
  label?: string;
}) {
  const svg = path?.length ? previewPathToSvg(path) : null;

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-amber-950/35 bg-zinc-950/80 ${className}`}
      aria-hidden={!svg}
      role={svg ? "img" : undefined}
      aria-label={svg ? label : undefined}
    >
      {svg ? (
        <svg
          viewBox={svg.viewBox}
          className="h-full w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <polyline
            points={svg.points}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-amber-400/90"
          />
        </svg>
      ) : (
        <div className="h-full w-full bg-[radial-gradient(circle_at_30%_30%,rgba(251,191,36,0.08),transparent_55%)]" />
      )}
    </div>
  );
}
