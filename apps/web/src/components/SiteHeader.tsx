import { SiteHeaderBar } from "@/components/SiteHeaderBar";
import { getAdminViewer } from "@/lib/supabase/admin";

export async function SiteHeader() {
  const admin = await getAdminViewer();
  return <SiteHeaderBar isAdmin={Boolean(admin)} />;
}
