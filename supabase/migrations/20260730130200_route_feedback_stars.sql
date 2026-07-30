-- Post-ride feedback: 1–5 stars, problem tags, ridden_at

-- Map legacy thumbs to stars before type change
update public.routes set rating = '5' where rating = 'up';
update public.routes set rating = '2' where rating = 'down';

alter table public.routes drop constraint if exists routes_rating_check;

alter table public.routes
  alter column rating type smallint
  using (
    case
      when rating is null then null
      when rating ~ '^[1-5]$' then rating::smallint
      else null
    end
  );

alter table public.routes
  add constraint routes_rating_check
  check (rating is null or (rating >= 1 and rating <= 5));

alter table public.routes
  add column if not exists feedback_tags text[] not null default '{}',
  add column if not exists ridden_at timestamptz;

-- Backfill ridden_at for routes that already had a rating
update public.routes
set ridden_at = created_at
where rating is not null and ridden_at is null;
