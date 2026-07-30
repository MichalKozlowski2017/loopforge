import Link from "next/link";
import { listGenerations } from "@/lib/admin/stats";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default async function AdminGenerationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status =
    params.status === "success" || params.status === "error"
      ? params.status
      : undefined;
  const generations = await listGenerations(80, status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <FilterLink href="/admin/generations" active={!status} label="Wszystkie" />
        <FilterLink
          href="/admin/generations?status=success"
          active={status === "success"}
          label="OK"
        />
        <FilterLink
          href="/admin/generations?status=error"
          active={status === "error"}
          label="Błędy"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Czas</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Request</th>
              <th className="px-3 py-2 font-medium">Latency</th>
              <th className="px-3 py-2 font-medium">Szczegóły</th>
            </tr>
          </thead>
          <tbody>
            {generations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-zinc-500">
                  Brak eventów (generuj trasę po wdrożeniu logowania eventów).
                </td>
              </tr>
            ) : (
              generations.map((row) => (
                <tr key={row.id} className="border-b border-zinc-900/80 align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-400">
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    {row.status === "success" ? (
                      <span className="text-emerald-400">ok</span>
                    ) : (
                      <span className="text-red-300">error</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    {[row.bikeType, row.distanceKm != null ? `${row.distanceKm} km` : null, row.direction, row.profile]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {row.latencyMs != null
                      ? `${(row.latencyMs / 1000).toFixed(1)}s`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">
                    {row.errorMessage ? (
                      <span className="text-red-300/90">{row.errorMessage}</span>
                    ) : row.routeId ? (
                      <Link
                        href={`/routes/${row.routeId}`}
                        className="text-amber-400 hover:underline"
                      >
                        trasa
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 ${
        active
          ? "bg-amber-500/15 text-amber-200"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
      }`}
    >
      {label}
    </Link>
  );
}
