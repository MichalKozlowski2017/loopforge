-- Favorites survive history prune (25 newest non-favorites).

alter table public.routes
  add column if not exists is_favorite boolean not null default false,
  add column if not exists favorited_at timestamptz;

create index if not exists routes_user_favorites_idx
  on public.routes (user_id, favorited_at desc)
  where is_favorite = true;
