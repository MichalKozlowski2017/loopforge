import { getDashboardStats, pingBrouter } from "@/lib/admin/stats";

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-50">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export default async function AdminHomePage() {
  const [stats, health] = await Promise.all([
    getDashboardStats(),
    pingBrouter(),
  ]);

  const gens = stats.generationsLast24h;

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Użytkownicy" value={stats.usersTotal} />
        <StatCard
          label="Trasy 24h / 7d"
          value={`${stats.routesLast24h} / ${stats.routesLast7d}`}
          hint={`łącznie ${stats.routesTotal}`}
        />
        <StatCard
          label="Generate 24h"
          value={`${gens.success} ok / ${gens.error} err`}
          hint={
            gens.avgLatencyMs != null
              ? `średnio ${Math.round(gens.avgLatencyMs / 1000)}s`
              : "brak pomiarów"
          }
        />
        <StatCard
          label="Ratingi"
          value={`👍 ${stats.ratings.up} · 👎 ${stats.ratings.down}`}
          hint={`bez oceny: ${stats.ratings.none}`}
        />
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="text-sm font-medium text-zinc-200">BRouter</h2>
        <p className="mt-2 text-sm text-zinc-400">
          {health.ok ? (
            <span className="text-emerald-400">
              OK · {health.latencyMs} ms · {health.url}
            </span>
          ) : (
            <span className="text-red-300">
              DOWN · {health.error}
              {health.url ? ` · ${health.url}` : ""}
            </span>
          )}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-200">Top bike types</h2>
          <ul className="mt-3 space-y-1 text-sm text-zinc-400">
            {stats.topBikeTypes.length === 0 ? (
              <li>—</li>
            ) : (
              stats.topBikeTypes.map((row) => (
                <li key={row.bikeType} className="flex justify-between gap-4">
                  <span>{row.bikeType}</span>
                  <span className="text-zinc-300">{row.count}</span>
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="rounded-xl border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-200">Top profiles</h2>
          <ul className="mt-3 space-y-1 text-sm text-zinc-400">
            {stats.topProfiles.length === 0 ? (
              <li>—</li>
            ) : (
              stats.topProfiles.map((row) => (
                <li key={row.profile} className="flex justify-between gap-4">
                  <span>{row.profile}</span>
                  <span className="text-zinc-300">{row.count}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
