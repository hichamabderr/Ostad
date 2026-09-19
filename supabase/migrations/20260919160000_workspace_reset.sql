create or replace function public.reset_workspace()
returns void
language plpgsql
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  delete from public.attendance where owner_id = current_user_id;
  delete from public.session_behaviors where owner_id = current_user_id;
  delete from public.sessions where owner_id = current_user_id;
  delete from public.grades where owner_id = current_user_id;
  delete from public.students where owner_id = current_user_id;
  delete from public.timetable_slots where owner_id = current_user_id;
  delete from public.lesson_progress where owner_id = current_user_id;
  delete from public.lesson_plans where owner_id = current_user_id;
  delete from public.custom_units where owner_id = current_user_id;
  delete from public.file_assets where owner_id = current_user_id;
  delete from public.memoranda_files where owner_id = current_user_id;
  delete from public.sync_conflicts where owner_id = current_user_id;
  delete from public.app_settings where owner_id = current_user_id;
  delete from public.classes where owner_id = current_user_id;
end;
$$;

revoke execute on function public.reset_workspace() from public;
grant execute on function public.reset_workspace() to authenticated;
