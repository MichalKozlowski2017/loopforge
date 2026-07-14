"use client";

interface ForgeLoaderAnimationProps {
  seconds: number;
}

/**
 * Hammer drawn in its impact pose: handle horizontal, head face flat on the
 * hot metal (bottom of head at y=118, centered on x=89). The strike animation
 * only rotates around the grip pivot (24, 98) — 0deg is the exact moment of
 * impact, negative angles raise the hammer.
 */
function HammerShape() {
  return (
    <g>
      {/* Handle */}
      <rect x="20" y="94.8" width="64" height="6.4" rx="3.2" fill="#a16207" />
      <rect x="20" y="94" width="14" height="8" rx="4" fill="#854d0e" />
      {/* Head — face down, resting on the metal */}
      <rect
        x="80"
        y="92"
        width="18"
        height="26"
        rx="2.5"
        fill="url(#forgeHammerHead)"
      />
      {/* Cross-peen on top */}
      <path d="M 84 92 L 94 92 L 91 84 L 87 84 Z" fill="#52525b" />
      {/* Highlight */}
      <rect x="82" y="94.5" width="3" height="21" rx="1.5" fill="#d4d4d8" opacity="0.7" />
    </g>
  );
}

interface SparkBurstProps {
  delaySeconds?: number;
}

/** Four sparks flying out of one impact point in different arcs. */
function SparkBurst({ delaySeconds = 0 }: SparkBurstProps) {
  const delay = (offset: number) => ({
    animationDelay: `${delaySeconds + offset}s`,
  });
  return (
    <g>
      <circle r="2.6" className="fill-amber-300 loopforge-spark loopforge-spark-a" style={delay(0)} />
      <circle r="2" className="fill-yellow-200 loopforge-spark loopforge-spark-b" style={delay(0.02)} />
      <circle r="2.4" className="fill-orange-400 loopforge-spark loopforge-spark-c" style={delay(0.01)} />
      <circle r="1.8" className="fill-amber-400 loopforge-spark loopforge-spark-d" style={delay(0.03)} />
    </g>
  );
}

/** Animated anvil + twin alternating hammers for the generation overlay. */
export function ForgeLoaderAnimation({ seconds }: ForgeLoaderAnimationProps) {
  return (
    <div className="relative h-36 w-36 sm:h-44 sm:w-44">
      <div className="absolute inset-0 rounded-full bg-amber-500/15 blur-2xl loopforge-forge-glow" />
      <div className="absolute bottom-6 left-1/2 h-8 w-24 -translate-x-1/2 rounded-full bg-orange-500/25 blur-xl loopforge-ember-pulse" />

      <svg viewBox="0 0 200 200" className="relative h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="forgeAnvil" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#71717a" />
            <stop offset="100%" stopColor="#3f3f46" />
          </linearGradient>
          <linearGradient id="forgeMetal" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="50%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#ea580c" />
          </linearGradient>
          <linearGradient id="forgeHammerHead" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#a1a1aa" />
            <stop offset="55%" stopColor="#71717a" />
            <stop offset="100%" stopColor="#3f3f46" />
          </linearGradient>
          <radialGradient id="forgeFlash">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="55%" stopColor="#fbbf24" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Anvil + hot metal (jolts on every hit) */}
        <g className="loopforge-anvil">
          <path
            d="M 52 138 L 148 138 L 132 158 L 68 158 Z"
            fill="url(#forgeAnvil)"
          />
          <path d="M 68 138 L 132 138 L 124 128 L 76 128 Z" fill="#52525b" />
          <rect x="76" y="127.4" width="48" height="1.6" fill="#71717a" />
          <rect
            x="78"
            y="118"
            width="44"
            height="10"
            rx="2"
            fill="url(#forgeMetal)"
            className="loopforge-hot-metal"
          />
        </g>

        {/* Left hammer — strikes at (89, 118) */}
        <g className="loopforge-hammer">
          <HammerShape />
        </g>
        {/* Right hammer — mirrored, strikes at (111, 118) half a cycle later */}
        <g transform="translate(200 0) scale(-1 1)">
          <g className="loopforge-hammer" style={{ animationDelay: "-0.75s" }}>
            <HammerShape />
          </g>
        </g>

        {/* Impact flashes */}
        <g transform="translate(89 116)">
          <circle r="12" fill="url(#forgeFlash)" className="loopforge-impact-flash" />
        </g>
        <g transform="translate(111 116)">
          <circle
            r="12"
            fill="url(#forgeFlash)"
            className="loopforge-impact-flash"
            style={{ animationDelay: "-0.75s" }}
          />
        </g>

        {/* Spark bursts synced to each hit */}
        <g transform="translate(89 116)">
          <SparkBurst />
        </g>
        <g transform="translate(111 116) scale(-1 1)">
          <SparkBurst delaySeconds={-0.75} />
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center">
        <span className="rounded-full border border-amber-500/30 bg-zinc-950/80 px-3 py-1 font-mono text-sm font-semibold tabular-nums text-amber-200">
          {seconds}s
        </span>
      </div>
    </div>
  );
}
