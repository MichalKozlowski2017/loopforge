# Fazy wdrożenia — checklist

## Faza 0 — Mapa + generowanie lokalnie (2–3 tyg.)

- [ ] Monorepo: `apps/web`, `packages/scoring`, `packages/generator`, `packages/gpx`
- [ ] Next.js + MapLibre (OpenFreeMap)
- [ ] Selektor trybu: szosa / gravel / MTB / ogólny
- [ ] Formularz: dystans, kierunek, podprofil
- [ ] `POST /api/routes/generate` → BRouter JAR (lokalnie)
- [ ] Trasa na mapie z kolorami nawierzchni
- [ ] Panel metryk + ocena wstępna 👍/👎
- [ ] Eksport GPX
- [ ] Zapis tras w `data/routes.json`
- [ ] **8–12 tras testowych** (2–3 per tryb) w terenie

**Kryterium sukcesu:** ≥ 2/3 tras OK per tryb (mapa + przejazd 4+/5). Kolejność: gravel → szosa → MTB → ogólny.

---

## Faza 1 — Supabase + pgRouting + Vercel (3–4 tyg.)

- [ ] Włączyć PostGIS + pgRouting w Supabase
- [ ] Import OSM PL (`osm2pgsql` → Geofabrik `poland-latest.osm.pbf`)
- [ ] Precompute `scores_json` + kolumny `cost_*`
- [ ] Zamiana BRouter → pgRouting w Route Handler
- [ ] Deploy Vercel Pro
- [ ] DNS: `loopforge.pl` → Vercel
- [ ] (Opcjonalnie) `loopforge.eu` → redirect na `.pl`
- [ ] Migracja tras z `data/routes.json` do Supabase

---

## Faza 2 — Zamknięty dostęp + historia (1–2 tyg.)

- [ ] Supabase Auth + whitelist emaila
- [ ] `/routes` — historia tras
- [ ] Feedback po przejeździe (ocena + notatki per segment)

---

## Faza 3 — Testy terenowe (4–8 tyg.)

- [ ] 24–32 trasy (6–8 per tryb)
- [ ] Regiony: Mazowsze, Mazury, Beskid, Pomorze
- [ ] Iteracja wag scoringu z feedbacku
- [ ] Cel: ≥ 70% tras z oceną 4+/5

---

## Faza 4 — Go / no-go

- [ ] ≥ 70% → rozważ beta / znajomi
- [ ] < 70% → dalsze strojenie, bez publicznego launchu

---

## Faza 2+ (później)

- [ ] ML predykcja nawierzchni (OSM + SRTM + landcover)
- [ ] Landcover CORINE (procent lasu)
- [ ] Trasy A→B, bikepacking 100+ km
