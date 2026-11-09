-- ============================================================
-- Follow-up fixes for security hardening
-- ============================================================

-- ----------------------------
-- Student review flag
-- ----------------------------
alter table public.students
  add column if not exists needs_review boolean not null default false;

-- ----------------------------
-- One submission per student per answer key (case-insensitive)
-- ----------------------------
alter table public.students
  drop constraint if exists students_student_id_answer_key_id_unique;

create unique index if not exists students_answer_key_student_id_lower_idx
  on public.students (answer_key_id, lower(student_id));

-- ----------------------------
-- Ownership rules: teachers can only touch their own answer keys/students
-- ----------------------------
drop policy if exists "Teachers read answer_keys" on public.answer_keys;
drop policy if exists "Teachers manage answer_keys" on public.answer_keys;
drop policy if exists "Authenticated read answer_keys" on public.answer_keys;
drop policy if exists "Authenticated manage answer_keys" on public.answer_keys;

create policy "Owners read answer_keys"
  on public.answer_keys for select
  to authenticated
  using (public.is_admin() or created_by = auth.uid());

create policy "Owners manage answer_keys"
  on public.answer_keys for all
  to authenticated
  using (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());

drop policy if exists "Teachers read students" on public.students;
drop policy if exists "Teachers manage students" on public.students;

create policy "Owners read students"
  on public.students for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.answer_keys ak
      where ak.id = students.answer_key_id
        and ak.created_by = auth.uid()
    )
  );

create policy "Owners manage students"
  on public.students for all
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.answer_keys ak
      where ak.id = students.answer_key_id
        and ak.created_by = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1
      from public.answer_keys ak
      where ak.id = students.answer_key_id
        and ak.created_by = auth.uid()
    )
  );

-- ----------------------------
-- Public student lookup by exact ID and/or full name
-- ----------------------------
create or replace function public.search_student_records(
  p_answer_key_id integer,
  p_student_id text,
  p_fullname text
)
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
    and (
      nullif(trim(p_student_id), '') is null
      or lower(s.student_id) = lower(trim(p_student_id))
    )
    and (
      nullif(trim(p_fullname), '') is null
      or lower(s.fullname) = lower(trim(p_fullname))
    )
  order by s.created_at desc
  limit 20
$$;

revoke all on function public.search_student_records(integer, text, text) from public;
grant execute on function public.search_student_records(integer, text, text) to anon, authenticated;

-- ----------------------------
-- Student uploads go through /api/upload (service role)
-- ----------------------------
drop policy if exists "Students upload student-answers objects" on storage.objects;
