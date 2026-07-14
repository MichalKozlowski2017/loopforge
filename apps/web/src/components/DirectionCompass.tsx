"use client";

import type { Direction } from "@loopforge/osm-types";

const DIRECTIONS: {
  value: Direction;
  label: string;
  short: string;
  bearing: number;
}[] = [
  { value: "N", label: "Północ", short: "N", bearing: 0 },
  { value: "NE", label: "Płn-wsch.", short: "NE", bearing: 45 },
  { value: "E", label: "Wschód", short: "E", bearing: 90 },
  { value: "SE", label: "Płd-wsch.", short: "SE", bearing: 135 },
  { value: "S", label: "Południe", short: "S", bearing: 180 },
  { value: "SW", label: "Płd-zach.", short: "SW", bearing: 225 },
  { value: "W", label: "Zachód", short: "W", bearing: 270 },
  { value: "NW", label: "Płn-zach.", short: "NW", bearing: 315 },
];

interface DirectionCompassProps {
  value: Direction;
  onChange: (direction: Direction) => void;
}

const CX = 80;
const CY = 80;
const R = 56;
const INNER = 22;

function wedgePath(bearingDeg: number, spreadDeg: number): string {
  const start = ((bearingDeg - spreadDeg / 2 - 90) * Math.PI) / 180;
  const end = ((bearingDeg + spreadDeg / 2 - 90) * Math.PI) / 180;
  const x1 = CX + R * Math.cos(start);
  const y1 = CY + R * Math.sin(start);
  const x2 = CX + R * Math.cos(end);
  const y2 = CY + R * Math.sin(end);
  return `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2} Z`;
}

function labelPosition(bearingDeg: number): { x: number; y: number } {
  const rad = ((bearingDeg - 90) * Math.PI) / 180;
  const dist = R + 14;
  return {
    x: CX + dist * Math.cos(rad),
    y: CY + dist * Math.sin(rad),
  };
}

export function DirectionCompass({ value, onChange }: DirectionCompassProps) {
  const active = DIRECTIONS.find((d) => d.value === value) ?? DIRECTIONS[0];
  const arrowRotation = active.bearing;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium text-zinc-300">
          Kierunek trasy
        </label>
        <span className="text-sm text-amber-400">{active.label}</span>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Dłuższa część pętli w wybranym kierunku — kliknij na kompasie.
      </p>

      <div className="mx-auto w-fit">
        <svg
          viewBox="0 0 160 160"
          className="h-40 w-40"
          role="group"
          aria-label="Wybór kierunku trasy"
        >
          <circle
            cx={CX}
            cy={CY}
            r={R + 6}
            className="fill-zinc-900 stroke-zinc-700"
            strokeWidth={1}
          />

          {DIRECTIONS.map((dir) => {
            const selected = dir.value === value;
            const pos = labelPosition(dir.bearing);
            return (
              <g key={dir.value}>
                <path
                  d={wedgePath(dir.bearing, 44)}
                  className={
                    selected
                      ? "fill-orange-500/35 stroke-amber-500/60 cursor-pointer"
                      : "fill-zinc-800/80 stroke-zinc-700/50 cursor-pointer hover:fill-zinc-700/80"
                  }
                  strokeWidth={1}
                  onClick={() => onChange(dir.value)}
                />
                <text
                  x={pos.x}
                  y={pos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className={`pointer-events-none select-none text-[10px] font-semibold ${
                    selected ? "fill-amber-300" : "fill-zinc-400"
                  }`}
                >
                  {dir.short}
                </text>
              </g>
            );
          })}

          <circle
            cx={CX}
            cy={CY}
            r={INNER}
            className="fill-zinc-950 stroke-zinc-600"
            strokeWidth={1}
          />

          <g transform={`rotate(${arrowRotation} ${CX} ${CY})`}>
            <line
              x1={CX}
              y1={CY + 8}
              x2={CX}
              y2={CY - 38}
              className="stroke-amber-400"
              strokeWidth={3}
              strokeLinecap="round"
            />
            <polygon
              points={`${CX},${CY - 44} ${CX - 6},${CY - 30} ${CX + 6},${CY - 30}`}
              className="fill-amber-400"
            />
          </g>

          <text
            x={CX}
            y={CY + 4}
            textAnchor="middle"
            dominantBaseline="middle"
            className="pointer-events-none fill-zinc-500 text-[9px]"
          >
            start
          </text>
        </svg>
      </div>
    </div>
  );
}
