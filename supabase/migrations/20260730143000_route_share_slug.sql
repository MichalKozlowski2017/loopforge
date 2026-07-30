-- Opt-in public share links (unguessable slug). No public RLS — read via service role API.

alter table public.routes
  add column if not exists share_slug text;

create unique index if not exists routes_share_slug_idx
  on public.routes (share_slug)
  where share_slug is not null;
