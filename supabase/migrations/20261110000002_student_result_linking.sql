-- ============================================================
-- Link anonymous quiz submissions to student accounts
-- A student can submit a quiz before creating an account. When
-- they later create a Student account, they can claim the
-- unlinked submissions that match their student ID and full name.
-- ============================================================

alter table public.students
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_students_user_id on public.students(user_id);

drop policy if exists "Students read own submissions" on public.students;
create policy "Students read own submissions"
  on public.students for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.claim_student_records(
  p_student_id text,
  p_fullname text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role integer := public.current_role_id();
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1
    from public.roles r
    where r.id = v_role
      and lower(r.title) = 'student'
  ) then
    raise exception 'Only student accounts can claim results';
  end if;

  if nullif(trim(p_student_id), '') is null or nullif(trim(p_fullname), '') is null then
    raise exception 'Student ID and full name are required';
  end if;

  update public.students s
  set user_id = v_uid
  where s.user_id is null
    and lower(trim(s.student_id)) = lower(trim(p_student_id))
    and lower(trim(s.fullname)) = lower(trim(p_fullname));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_student_records(text, text) from public;
grant execute on function public.claim_student_records(text, text) to authenticated;

create or replace function public.get_my_student_results()
returns table (
  id integer,
  created_at timestamptz,
  fullname text,
  student_id text,
  score numeric,
  remarks text,
  answer_key_id integer,
  quiz_title text,
  quiz_description text,
  image_url text,
  answers jsonb,
  needs_review boolean
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
    ak.title as quiz_title,
    ak.description as quiz_description,
    s.image_url,
    s.answers,
    s.needs_review
  from public.students s
  left join public.answer_keys ak on ak.id = s.answer_key_id
  where s.user_id = auth.uid()
  order by s.created_at desc
$$;

revoke all on function public.get_my_student_results() from public;
grant execute on function public.get_my_student_results() to authenticated;
