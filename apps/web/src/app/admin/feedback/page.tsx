import Link from "next/link";
import { listDownFeedback } from "@/lib/admin/stats";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminFeedbackPage() {
  const feedback = await listDownFeedback();

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">
        Ostatnie trasy z oceną 👎 (i opcjonalnymi notatkami).
      </p>
      {feedback.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 px-4 py-8 text-center text-zinc-500">
          Brak negatywnych ocen.
        </p>
      ) : (
        <ul className="space-y-3">
          {feedback.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-zinc-100">
                    {item.bikeType} · {item.distanceKm.toFixed(1)} km
                    {item.score != null
                      ? ` · score ${(item.score * 100).toFixed(0)}%`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatDate(item.createdAt)} · user {item.userId.slice(0, 8)}…
                  </p>
                </div>
                <Link
                  href={`/routes/${item.id}`}
                  className="text-xs text-amber-400 hover:underline"
                >
                  Otwórz trasę
                </Link>
              </div>
              {item.notes ? (
                <p className="mt-3 text-sm italic text-zinc-300">„{item.notes}”</p>
              ) : (
                <p className="mt-3 text-sm text-zinc-600">Bez notatki</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
