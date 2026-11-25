-- Shared app settings (tube life design inputs) so every device uses the same values.
-- Applied to the "Uniformance" project on 2026-11-25. Browser reads/writes via /api/sb/rest/v1/app_settings.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy "app_settings read" on public.app_settings for select to anon, authenticated using (true);
create policy "app_settings insert" on public.app_settings for insert to anon, authenticated with check (key in ('tube_life_inputs'));
create policy "app_settings update" on public.app_settings for update to anon, authenticated using (key in ('tube_life_inputs')) with check (key in ('tube_life_inputs'));
insert into public.app_settings(key, value) values ('tube_life_inputs', '{"serviceStart":"2026-09-05","tmtLimit":970}'::jsonb) on conflict (key) do nothing;
