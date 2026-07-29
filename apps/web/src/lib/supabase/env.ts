/**
 * Supabase public env — supports both legacy anon key and newer publishable key.
 */
export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || undefined;
}

export function getSupabaseAnonKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    undefined
  );
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

/** When false, generate stays open (local emergency / missing providers). */
export function isAuthRequired(): boolean {
  const flag =
    process.env.AUTH_REQUIRED ?? process.env.NEXT_PUBLIC_AUTH_REQUIRED;
  if (flag === "0" || flag === "false") {
    return false;
  }
  return isSupabaseConfigured();
}
