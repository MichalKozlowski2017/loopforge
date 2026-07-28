"use client";

export interface RouteSummaryMetric {
  label: string;
  score: number;
  detail: string;
}

interface RouteSummaryDialogProps {
  title: string;
  subtitle: string;
  metrics: RouteSummaryMetric[];
  notes: string[];
  onDismiss: () => void;
}

function scoreTone(score: number): string {
  if (score >= 85) return "bg-emerald-500";
  if (score >= 65) return "bg-amber-500";
  return "bg-rose-500";
}

function scoreTextTone(score: number): string {
  if (score >= 85) return "text-emerald-300";
  if (score >= 65) return "text-amber-300";
  return "text-rose-300";
}

export function RouteSummaryDialog({
  title,
  subtitle,
  metrics,
  notes,
  onDismiss,
}: RouteSummaryDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="route-summary-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-5 shadow-2xl">
        <h2 id="route-summary-title" className="text-lg font-semibold text-zinc-100">
          {title}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>

        <div className="mt-5 space-y-3">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-zinc-800 p-3">
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-zinc-300">{metric.label}</span>
                <span className={`font-medium ${scoreTextTone(metric.score)}`}>
                  {metric.score}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-all ${scoreTone(metric.score)}`}
                  style={{ width: `${Math.max(4, Math.min(100, metric.score))}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-zinc-500">{metric.detail}</p>
            </div>
          ))}
        </div>

        {notes.length > 0 ? (
          <ul className="mt-4 space-y-1 text-sm text-zinc-400">
            {notes.map((note) => (
              <li key={note} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-500" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <button
          type="button"
          onClick={onDismiss}
          className="mt-5 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-amber-400"
        >
          Zamknij
        </button>
      </div>
    </div>
  );
}
