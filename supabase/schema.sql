-- aimvp: account sync. Run once in Supabase → SQL Editor; running it again is safe.

-- One row per synced record: projects, chats, messages, saved prompts, preferences.
-- `data` is the record as the app stores it; `updated_at` is the app's own timestamp
-- (newer wins), and `modified_at` is when the server took the change, which devices
-- use to pull what changed since they last looked.
create table if not exists public.sync_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null,
  id text not null,
  data jsonb not null,
  updated_at bigint not null,
  modified_at timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, id)
);

create index if not exists sync_records_user_modified on public.sync_records (user_id, modified_at);

alter table public.sync_records enable row level security;

-- Explicit, so this works whether or not the project exposes new tables automatically.
revoke all on public.sync_records from anon;
grant select, insert, update on public.sync_records to authenticated;

drop policy if exists "Users read their own records" on public.sync_records;
create policy "Users read their own records" on public.sync_records
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Writes go through push_records, which runs as the caller, so these apply to it too.
drop policy if exists "Users add their own records" on public.sync_records;
create policy "Users add their own records" on public.sync_records
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users update their own records" on public.sync_records;
create policy "Users update their own records" on public.sync_records
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Stores records, keeping the stored one when it is newer (last write wins).
create or replace function public.push_records(records jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.sync_records (user_id, kind, id, data, updated_at)
  select (select auth.uid()), r.kind, r.id, r.data, r.updated_at
  from jsonb_to_recordset(records) as r (kind text, id text, data jsonb, updated_at bigint)
  on conflict (user_id, kind, id) do update
    set data = excluded.data,
        updated_at = excluded.updated_at,
        modified_at = clock_timestamp()
    where public.sync_records.updated_at < excluded.updated_at;
$$;

revoke execute on function public.push_records(jsonb) from public, anon;
grant execute on function public.push_records(jsonb) to authenticated;

-- Attachments (images, PDFs) as private files under each user's own folder: <user id>/<file id>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "Users read their own attachments" on storage.objects;
create policy "Users read their own attachments" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "Users upload their own attachments" on storage.objects;
create policy "Users upload their own attachments" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid()::text));

drop policy if exists "Users delete their own attachments" on storage.objects;
create policy "Users delete their own attachments" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid()::text));
