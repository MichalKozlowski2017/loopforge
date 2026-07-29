# Auth — Google + Apple (Supabase)

Soft-gate: mapa i formularz działają bez konta; **Generuj** wymaga zalogowanej sesji (`POST /api/routes/generate`).

## Co jest w kodzie

| Element | Ścieżka |
|---|---|
| Browser / server clients | `apps/web/src/lib/supabase/` |
| Session refresh (Next 16 proxy) | `apps/web/src/proxy.ts` |
| Login UI | `/login` |
| OAuth callback | `/auth/callback` |
| Header (Zaloguj / Wyloguj) | `AuthControls` w `SiteHeader` |

Wyłączenie awaryjne — ustaw **oba**, żeby UI i API się zgadzały:

```bash
# apps/web/.env.local  (i Vercel)
NEXT_PUBLIC_AUTH_REQUIRED=0
AUTH_REQUIRED=0
```

(`NEXT_PUBLIC_*` jest widoczne w przeglądarce i wyłącza soft-gate przed fetch; `AUTH_REQUIRED` wyłącza guard na API.)

## Redirect URL-e

W **Supabase → Authentication → URL Configuration**:

| | |
|---|---|
| Site URL | `https://loopforge.pl` (prod) / `http://localhost:3000` (dev) |
| Redirect URLs | `https://loopforge.pl/auth/callback` |
| | `http://localhost:3000/auth/callback` |

Callback OAuth w Google/Apple musi wskazywać na **Supabase**, nie na Loopforge:

`https://ivaarrzxpoffwbmvwitc.supabase.co/auth/v1/callback`

## Google Cloud

1. [Google Cloud Console](https://console.cloud.google.com/) → Credentials → **OAuth client ID** (Web).
2. Authorized JavaScript origins: `https://ivaarrzxpoffwbmvwitc.supabase.co`, opcjonalnie `http://localhost:3000`.
3. Authorized redirect URIs: `https://ivaarrzxpoffwbmvwitc.supabase.co/auth/v1/callback`.
4. Supabase → Authentication → Providers → **Google** → wklej Client ID + Client Secret → Enable.

## Apple (Sign in with Apple)

1. [Apple Developer](https://developer.apple.com/) → Certificates, Identifiers & Profiles.
2. **App ID** z capability *Sign In with Apple* (jeśli jeszcze nie ma).
3. **Services ID** (np. `pl.loopforge.web`) — to jest „Client ID” dla weba.
4. Na Services ID: Configure domains + return URL:
   - Domains: `ivaarrzxpoffwbmvwitc.supabase.co`
   - Return URLs: `https://ivaarrzxpoffwbmvwitc.supabase.co/auth/v1/callback`
5. Utwórz **Key** (Sign in with Apple) → pobierz `.p8` (raz).
6. Supabase → Providers → **Apple**:
   - Client IDs: Services ID
   - Secret Key (`.p8`), Key ID, Team ID
   - Enable

Apple Developer Program jest płatny — bez niego tylko Google.

## Env

```bash
NEXT_PUBLIC_SUPABASE_URL=https://ivaarrzxpoffwbmvwitc.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...   # Dashboard → Settings → API
```

Na Vercel te same `NEXT_PUBLIC_*`. Po włączeniu providerów w Dashboard wyłącz `AUTH_REQUIRED=0` (jeśli było ustawione).

## Test lokalny

1. `pnpm dev`
2. Otwórz mapę bez logowania — formularz OK.
3. Generuj → redirect na `/login`.
4. Google (lub Apple) → powrót na `/` z sesją → Generuj działa.
5. Header: nazwa / Wyloguj.
6. Po generate → `/routes` pokazuje trasę z chmury (per konto, RLS).

## Historia tras (chmura)

Po zalogowaniu wygenerowane trasy trafiają do `public.routes` z `user_id = auth.uid()` (limit 25 / konto).  
API: `GET/POST /api/routes`, `GET /api/routes/[id]`, `POST .../rate`, `GET .../gpx`.  
localStorage nie jest już źródłem prawdy.