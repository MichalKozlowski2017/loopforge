# BRouter segments (planet)

Produkcja: `BROUTER_URL=https://router.loopforge.pl` na VPS.

Lokalnie segmenty są w `infra/brouter/segments4/` (**gitignored**, ~9.5 GiB dla `planet`).

```bash
pnpm setup:brouter:planet   # cały świat (~9 GiB)
pnpm setup:brouter:europe   # Europa (~3 GiB)
pnpm setup:brouter:italy
pnpm setup:brouter:poland   # domyślne
```

## Sync na VPS (40 GB dysku — planet się mieści)

Host: `ubuntu@51.83.202.158` (`router.loopforge.pl`)

```bash
rsync -avz --progress infra/brouter/segments4/ ubuntu@51.83.202.158:~/segments4-staging/
ssh ubuntu@51.83.202.158 'sudo rsync -a ~/segments4-staging/ /opt/loopforge/brouter/segments4/ \
  && sudo chown -R brouter:brouter /opt/loopforge/brouter \
  && rm -rf ~/segments4-staging \
  && sudo systemctl restart brouter'
```

Po restarcie: smoke test z punktu we Włoszech (np. Mediolan `9.19,45.46`) przez generate na loopforge.pl.

RAM: przy pełnym planet lepiej ≥2–4 GB na VPS (cache FS). Heap Javy w `brouter.service` może zostać 512M–1G — kafle i tak żyją głównie w page cache.
