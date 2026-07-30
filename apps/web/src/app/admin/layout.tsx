import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/supabase/admin";

const NAV = [
  { href: "/admin", label: "Przegląd" },
  { href: "/admin/users", label: "Użytkownicy" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/generations", label: "Generowania" },
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    if (auth.status === 401) {
      redirect(`/login?next=${encodeURIComponent("/admin")}`);
    }
    redirect("/");
  }

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-500/90">
            Ops
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-50">Panel admina</h1>
        </div>
        <Link href="/" className="text-sm text-zinc-400 hover:text-amber-200">
          ← Generator
        </Link>
      </div>
      <nav className="mb-8 flex flex-wrap gap-2 border-b border-zinc-800 pb-3 text-sm">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-1.5 text-zinc-400 transition hover:bg-zinc-900 hover:text-amber-200"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
