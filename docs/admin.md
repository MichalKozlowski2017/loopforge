# Panel admina (`/admin`)

Wewnętrzny panel ops: statystyki, użytkownicy (ban), feedback 👎, log generowań, ping BRouter.

## Dostęp

1. Na Vercel / `.env.local` ustaw **`SUPABASE_SERVICE_ROLE_KEY`** (Dashboard → Settings → API → `service_role`). Nigdy `NEXT_PUBLIC_*`.
2. Nadaj sobie rolę w `app_metadata` (nie `user_metadata`):

W SQL Editor (Supabase):

```sql
update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'TWOJ_EMAIL@example.com';
```

Albo Dashboard → Authentication → Users → user → App Metadata:

```json
{ "role": "admin" }
```

3. Wyloguj się i zaloguj ponownie (odświeżenie JWT).
4. W headerze pojawi się **Admin** → `/admin`.

Bez roli albo bez service role → redirect na `/` (layout) / 403 na API.

## Co jest w panelu

| Strona | Zawartość |
|--------|-----------|
| `/admin` | Users, trasy 24h/7d, generate ok/err + latency, ratingi, top bike/profile, BRouter health |
| `/admin/users` | Lista Auth users, #tras, ban/unban |
| `/admin/feedback` | Trasy z `rating=down` + notes |
| `/admin/generations` | `public.generation_events` (sukces/błąd) |

## Schema

Migracja `generation_events` — zapis best-effort z `POST /api/routes/generate` (nie blokuje SSE). Dostęp tylko `service_role`.
