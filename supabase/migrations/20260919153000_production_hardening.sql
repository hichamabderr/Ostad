-- Keep RLS evaluation single-path for memorandum metadata and cover the
-- student foreign key used by session behavior queries and cascades.
drop policy if exists "owners manage uploaded memoranda metadata" on public.memoranda_files;

create policy "owners insert uploaded memoranda metadata"
on public.memoranda_files
for insert
to authenticated
with check ((select auth.uid()) = owner_id and is_bundled = false);

create policy "owners update uploaded memoranda metadata"
on public.memoranda_files
for update
to authenticated
using ((select auth.uid()) = owner_id and is_bundled = false)
with check ((select auth.uid()) = owner_id and is_bundled = false);

create policy "owners delete uploaded memoranda metadata"
on public.memoranda_files
for delete
to authenticated
using ((select auth.uid()) = owner_id and is_bundled = false);

create index if not exists session_behaviors_student_id_idx
  on public.session_behaviors (student_id);
