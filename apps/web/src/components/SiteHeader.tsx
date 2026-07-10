import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
      <Link href="/" className="text-sm font-semibold tracking-wide text-emerald-400">
        Loopforge
      </Link>
      <nav className="flex gap-4 text-sm text-zinc-400">
        <Link href="/" className="transition hover:text-zinc-100">
          Generator
        </Link>
        <Link href="/routes" className="transition hover:text-zinc-100">
          Historia
        </Link>
      </nav>
    </header>
  );
}
