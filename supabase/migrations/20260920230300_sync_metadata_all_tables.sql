-- Every row-level synchronized table must carry the same conflict metadata.
do $$ declare table_name text;
begin
  foreach table_name in array array[
    'sessions', 'attendance', 'session_behaviors', 'timetable_slots',
    'curriculum_units', 'custom_units', 'lesson_progress', 'lesson_plans',
    'dashboard_tasks'
  ] loop
    execute format('alter table public.%I add column if not exists sync_revision bigint not null default 0', table_name);
    execute format('alter table public.%I add column if not exists sync_updated_at timestamptz not null default timezone(''utc'', now())', table_name);
    execute format('alter table public.%I add column if not exists sync_device_id text', table_name);
  end loop;
end $$;
