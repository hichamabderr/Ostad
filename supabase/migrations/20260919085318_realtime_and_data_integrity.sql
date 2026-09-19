-- Keep the core tables available to authenticated clients that subscribe to
-- user-scoped changes. This is idempotent for linked projects where some
-- tables may already be present in the publication.
do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['classes', 'students', 'grades'] loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end $$;

create index if not exists grades_owner_trimester_idx
  on public.grades (owner_id, trimester);

create index if not exists students_owner_name_idx
  on public.students (owner_id, normalized_name);