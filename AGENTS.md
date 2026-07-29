# AGENTS.md

Loopforge — a Polish bicycle **loop** route generator (Next.js 16 + MapLibre frontend, pnpm monorepo). One web app (`apps/web`, port 3000) plus shared library packages. Standard commands live in the root `package.json` scripts; setup details are in `docs/setup.md`.

## Cursor Cloud specific instructions

- **Dependency refresh** on startup is just `pnpm install` (the update script). Node 22, pnpm 9, and Java 21 are already present.
- **Run the app:** `pnpm dev` serves `apps/web` at http://localhost:3000. There is no separate long-running backend — API routes live inside the Next.js app.
- **Routing engine (important, non-obvious):** the generator needs a routing backend. The simplest local path is **BRouter** (uses the preinstalled Java). BRouter binaries/segments live under `infra/brouter/` and `apps/web/.env.local`, both of which are **gitignored** and are NOT restored by a git pull. If `infra/brouter/` is missing, run `pnpm setup:brouter:minimal` once (downloads a ~150 MB Warsaw-area segment set from external hosts and writes `apps/web/.env.local`). Use `pnpm setup:brouter:poland` for all-Poland coverage. Because segments are gitignored, **generated routes only work in areas whose `.rd5` segments were downloaded** (minimal = Warsaw / central Poland). Test start points there (e.g. Warszawa ~52.23, 21.01).
- BRouter is **auto-spawned** as a Java subprocess (port 17777) by `@loopforge/brouter` on the first `/api/routes/generate` request when `.env.local` points at local JAR/segments — no need to run `pnpm brouter` separately. The first route request is slower while Java starts.
- The alternative **Supabase + pgRouting** path (production-parity) requires Docker + Supabase CLI + osm2pgsql (none installed here) plus a multi-minute OSM import. Not needed for basic dev; prefer the BRouter path unless specifically working on pgRouting.
- Route history for logged-in users is stored in Supabase `public.routes` (RLS per `auth.uid()`). Server-side `/api/routes` CRUD requires auth. Generate soft-gate also requires auth when Supabase is configured.
- `pnpm lint` currently reports pre-existing errors in `apps/web/src/lib/use-geolocation.ts` (react-hooks rules). These are existing code issues, not an environment problem — the ESLint tooling itself runs correctly.
