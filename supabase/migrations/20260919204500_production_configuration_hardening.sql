-- Align the live database with the current client integration and tighten
-- privileges for the authenticated-only application.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'app_settings'
     ) then
    alter publication supabase_realtime add table public.app_settings;
  end if;
end $$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user_profile() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

revoke all on table
  public.profiles,
  public.app_settings,
  public.classes,
  public.students,
  public.grades,
  public.sessions,
  public.attendance,
  public.session_behaviors,
  public.timetable_slots,
  public.lesson_progress,
  public.lesson_plans,
  public.custom_units,
  public.file_assets,
  public.memoranda_files,
  public.sync_conflicts
from anon;
