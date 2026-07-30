import { listAdminUsers } from "@/lib/admin/stats";
import { BanUserButton } from "@/components/admin/BanUserButton";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminUsersPage() {
  const users = await listAdminUsers();

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-zinc-800 bg-zinc-900/60 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Provider</th>
            <th className="px-3 py-2 font-medium">Last sign-in</th>
            <th className="px-3 py-2 font-medium">Trasy</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-zinc-500">
                Brak użytkowników.
              </td>
            </tr>
          ) : (
            users.map((user) => (
              <tr key={user.id} className="border-b border-zinc-900/80">
                <td className="px-3 py-2 text-zinc-200">
                  {user.email ?? user.id.slice(0, 8)}
                </td>
                <td className="px-3 py-2 text-zinc-400">
                  {user.providers.join(", ") || "—"}
                </td>
                <td className="px-3 py-2 text-zinc-400">
                  {formatDate(user.lastSignInAt)}
                </td>
                <td className="px-3 py-2 text-zinc-300">{user.routeCount}</td>
                <td className="px-3 py-2">
                  {user.banned ? (
                    <span className="text-red-300">banned</span>
                  ) : (
                    <span className="text-zinc-500">active</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <BanUserButton userId={user.id} banned={user.banned} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
