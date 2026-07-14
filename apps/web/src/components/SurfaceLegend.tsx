"use client";

import { SURFACE_LEGEND } from "@loopforge/osm-types";

function LegendSwatch({
  color,
  dashed,
}: {
  color: string;
  dashed: boolean;
}) {
  return (
    <span
      className="inline-block h-1 w-7 shrink-0 rounded-full"
      style={{
        backgroundColor: color,
        backgroundImage: dashed
          ? `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 8px)`
          : undefined,
      }}
      aria-hidden
    />
  );
}

function LegendItems() {
  return (
    <ul className="space-y-1.5">
      {SURFACE_LEGEND.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-zinc-400">
          <LegendSwatch color={item.color} dashed={Boolean(item.dash)} />
          <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

function LegendHint() {
  return (
    <p className="mb-2 text-[10px] leading-snug text-zinc-500">
      Kolor i wzór kreski po lewej odpowiadają odcinkowi trasy. Na mapie ciągła
      linia to asfalt, przerywana — szuter, ścieżki i leśne drogi.
    </p>
  );
}

export function SurfaceLegend() {
  return (
    <>
      <details className="group absolute bottom-2 left-2 right-2 z-10 overflow-hidden rounded-lg border border-amber-950/30 bg-zinc-950/90 shadow-lg backdrop-blur lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-medium text-zinc-200 [&::-webkit-details-marker]:hidden">
          <span>Legenda nawierzchni</span>
          <span className="text-[10px] font-normal text-zinc-500 group-open:hidden">
            rozwiń
          </span>
          <span className="hidden text-[10px] font-normal text-zinc-500 group-open:inline">
            zwiń
          </span>
        </summary>
        <div className="max-h-[min(38vh,16rem)] overflow-y-auto border-t border-zinc-800 px-3 pb-3 pt-2">
          <LegendHint />
          <LegendItems />
        </div>
      </details>

      <div className="absolute bottom-4 left-4 z-10 hidden max-h-[70vh] max-w-xs overflow-y-auto rounded-lg border border-amber-950/30 bg-zinc-950/90 p-3 text-xs shadow-lg backdrop-blur lg:block">
        <p className="mb-1 font-medium text-zinc-200">Nawierzchnia na mapie</p>
        <LegendHint />
        <LegendItems />
      </div>
    </>
  );
}
