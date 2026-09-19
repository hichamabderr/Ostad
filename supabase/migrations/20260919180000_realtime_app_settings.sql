-- App settings contains the timetable, session notebook, lesson progress, and
-- other state that is synchronized as one owner-scoped snapshot.
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
