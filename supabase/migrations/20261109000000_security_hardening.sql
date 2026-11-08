-- ============================================================
-- Security hardening
-- ============================================================

-- ----------------------------
-- Move roles from user_metadata to app_metadata
-- ----------------------------
update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', raw_user_meta_data -> 'role')
where raw_user_meta_data ? 'role'
  and not (coalesce(raw_app_meta_data, '{}'::jsonb) ? 'role');

update auth.users
set raw_user_meta_data = raw_user_meta_data - 'role'
where raw_user_meta_data ? 'role';

-- ----------------------------
-- Role helpers (read from app_metadata / JWT)
-- ----------------------------
create or replace function public.current_role_id()
returns integer
language sql
stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'role', '')::integer
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_role_id() = 1, false)
$$;

create or replace function public.is_teacher_or_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_role_id() in (1, 2), false)
$$;

-- ----------------------------
-- Announcement publish flag
-- ----------------------------
alter table public.announcements
  add column if not exists is_published boolean not null default true;

-- ----------------------------
-- Drop legacy table policies
-- ----------------------------
drop policy if exists "Anyone read roles"              on public.roles;
drop policy if exists "Anyone read role_pages"          on public.role_pages;
drop policy if exists "Authenticated read roles"        on public.roles;
drop policy if exists "Authenticated read role_pages"   on public.role_pages;
drop policy if exists "Authenticated manage roles"      on public.roles;
drop policy if exists "Authenticated manage role_pages" on public.role_pages;
drop policy if exists "Authenticated CRUD answer_keys"  on public.answer_keys;
drop policy if exists "Anonymous read active answer_keys" on public.answer_keys;
drop policy if exists "Authenticated CRUD students"     on public.students;
drop policy if exists "Anonymous insert students"       on public.students;
drop policy if exists "Anonymous read students"         on public.students;
drop policy if exists "Authenticated CRUD announcements" on public.announcements;
drop policy if exists "Anonymous read announcements"    on public.announcements;

-- ----------------------------
-- Roles / role_pages
-- ----------------------------
create policy "Anon read non-admin roles"
  on public.roles for select
  to anon
  using (id <> 1);

create policy "Authenticated read roles"
  on public.roles for select
  to authenticated
  using (auth.role() = 'authenticated');

create policy "Admins manage roles"
  on public.roles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Authenticated read role_pages"
  on public.role_pages for select
  to authenticated
  using (auth.role() = 'authenticated');

create policy "Admins manage role_pages"
  on public.role_pages for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------
-- Answer keys (never expose the answer_keys JSON to anon)
-- ----------------------------
create policy "Teachers read answer_keys"
  on public.answer_keys for select
  to authenticated
  using (public.is_teacher_or_admin());

create policy "Teachers manage answer_keys"
  on public.answer_keys for all
  to authenticated
  using (public.is_teacher_or_admin())
  with check (public.is_teacher_or_admin());

create or replace view public.answer_keys_public
with (security_invoker = false) as
select
  id,
  created_at,
  updated_at,
  title,
  description,
  qr_link,
  is_active
from public.answer_keys
where is_active = true;

revoke all on public.answer_keys_public from public;
grant select on public.answer_keys_public to anon, authenticated;

-- ----------------------------
-- Students (anon can no longer read all rows)
-- ----------------------------
create policy "Teachers read students"
  on public.students for select
  to authenticated
  using (public.is_teacher_or_admin());

create policy "Teachers manage students"
  on public.students for all
  to authenticated
  using (public.is_teacher_or_admin())
  with check (public.is_teacher_or_admin());

create or replace function public.search_student_records(p_answer_key_id integer, p_student_id text, p_fullname text)
returns table (
  id integer,
  created_at timestamptz,
  fullname text,
  student_id text,
  score numeric,
  remarks text,
  answer_key_id integer,
  image_url text,
  answers jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.created_at,
    s.fullname,
    s.student_id,
    s.score,
    s.remarks,
    s.answer_key_id,
    s.image_url,
    s.answers
  from public.students s
  where s.answer_key_id = p_answer_key_id
    and lower(s.student_id) = lower(trim(p_student_id))
    and lower(s.fullname) = lower(trim(p_fullname))
  order by s.created_at desc
  limit 20
$$;

revoke all on function public.search_student_records(integer, text, text) from public;
grant execute on function public.search_student_records(integer, text, text) to authenticated;

-- ----------------------------
-- Announcements (anon sees published items only)
-- ----------------------------
create policy "Anon read published announcements"
  on public.announcements for select
  to anon
  using (is_published = true);

create policy "Authenticated read announcements"
  on public.announcements for select
  to authenticated
  using (auth.role() = 'authenticated');

create policy "Admins manage announcements"
  on public.announcements for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------
-- Storage buckets: private
-- ----------------------------
update storage.buckets
set public = false
where id in ('answer_keys', 'student-answers', 'announcements');

drop policy if exists "Authenticated upload answer_keys"     on storage.objects;
drop policy if exists "Authenticated manage answer_keys"     on storage.objects;
drop policy if exists "Anonymous read answer_keys"           on storage.objects;
drop policy if exists "Authenticated upload student-answers" on storage.objects;
drop policy if exists "Authenticated manage student-answers" on storage.objects;
drop policy if exists "Anonymous read student-answers"       on storage.objects;
drop policy if exists "Authenticated upload announcements"   on storage.objects;
drop policy if exists "Authenticated manage announcements"   on storage.objects;
drop policy if exists "Anonymous read announcements"         on storage.objects;

create policy "Teachers read answer_keys objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'answer_keys' and public.is_teacher_or_admin());

create policy "Teachers manage answer_keys objects"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'answer_keys' and public.is_teacher_or_admin())
  with check (bucket_id = 'answer_keys' and public.is_teacher_or_admin());

create policy "Students upload student-answers objects"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'student-answers');

create policy "Teachers manage student-answers objects"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'student-answers' and public.is_teacher_or_admin())
  with check (bucket_id = 'student-answers' and public.is_teacher_or_admin());

create policy "Anon read announcements objects"
  on storage.objects for select
  to anon
  using (bucket_id = 'announcements');

create policy "Admins manage announcements objects"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'announcements' and public.is_admin())
  with check (bucket_id = 'announcements' and public.is_admin());

-- ----------------------------
-- Rewrite existing public storage URLs to signed-URL proxy paths
-- ----------------------------
update public.announcements
set image_url = regexp_replace(
  image_url,
  '^.*/storage/v1/object/public/([^/]+)/(.*)$',
  '/api/signed-url?bucket=\1&path=\2'
)
where image_url ~ '/storage/v1/object/public/';

update public.answer_keys
set answer_images = regexp_replace(
  answer_images,
  '^.*/storage/v1/object/public/([^/]+)/(.*)$',
  '/api/signed-url?bucket=\1&path=\2'
)
where answer_images ~ '/storage/v1/object/public/';

update public.students
set image_url = regexp_replace(
  image_url,
  '^.*/storage/v1/object/public/([^/]+)/(.*)$',
  '/api/signed-url?bucket=\1&path=\2'
)
where image_url ~ '/storage/v1/object/public/';

-- ----------------------------
-- Unique constraint: one submission per student per answer key
-- ----------------------------
alter table public.students
  add constraint students_student_id_answer_key_id_unique unique (student_id, answer_key_id);

-- ----------------------------
-- Ownership rules for answer_keys (created_by = auth.uid())
-- ----------------------------
drop policy if exists "Authenticated read answer_keys" on public.answer_keys;
drop policy if exists "Authenticated manage answer_keys" on public.answer_keys;

create policy "Authenticated read answer_keys"
  on public.answer_keys for select
  to authenticated
  using (public.is_teacher_or_admin() or created_by = auth.uid());

create policy "Authenticated manage answer_keys"
  on public.answer_keys for all

-- ----------------------------
-- Unique constraint: one submission per student per answer key
-- ----------------------------
alter table public.students
  add constraint students_student_id_answer_key_id_unique unique (student_id, answer_key_id);

-- ----------------------------
-- Ownership rules for answer_keys (created_by = auth.uid())
-- ----------------------------
drop policy if exists "Authenticated read answer_keys" on public.answer_keys;
drop policy if exists "Authenticated manage answer_keys" on public.answer_keys;

create policy "Authenticated read answer_keys"
  on public.answer_keys for select
  to authenticated
  using (public.is_teacher_or_admin() or created_by = auth.uid());

create policy "Authenticated manage answer_keys"
  on public.answer_keys for all
  to authenticated
  using (public.is_teacher_or_admin() or created_by = auth.uid())
  with check (public.is_teacher_or_admin() or created_by = auth.uid());
