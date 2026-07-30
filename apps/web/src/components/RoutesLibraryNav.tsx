import Link from "next/link";

export function RoutesLibraryNav({
  active,
}: {
  active: "history" | "favorites";
}) {
  const base =
    "rounded-lg px-3 py-1.5 text-sm transition border border-transparent";
  const idle = `${base} text-zinc-400 hover:text-amber-100`;
  const on = `${base} border-amber-700/40 bg-amber-500/10 text-amber-100`;

  return (
    <div className="mb-5 flex flex-wrap gap-2">
      <Link href="/routes" className={active === "history" ? on : idle}>
        Historia
      </Link>
      <Link
        href="/routes/favorites"
        className={active === "favorites" ? on : idle}
      >
        Ulubione
      </Link>
    </div>
  );
}
