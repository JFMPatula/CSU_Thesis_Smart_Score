-- Ensure teacher/admin accounts can access their tools even if role_pages were not seeded
-- for an existing database, and lock legacy unclaimed submissions.

-- Teacher permissions (idempotent)
insert into public.role_pages (role_id, pages)
select r.id, p.page
from public.roles r
join (values
  ('teacher.access'),
  ('teacher.answerkey.manage'),
  ('teacher.students.view')
) as p(page) on true
where lower(r.title) = 'teacher'
  and not exists (
    select 1 from public.role_pages rp
    where rp.role_id = r.id and rp.pages = p.page
  );

-- Admin permissions (idempotent, defensive)
insert into public.role_pages (role_id, pages)
select r.id, p.page
from public.roles r
join (values
  ('admin.dashboard.view'),
  ('admin.access'),
  ('admin.users.manage'),
  ('admin.roles.manage'),
  ('admin.announcements.manage')
) as p(page) on true
where lower(r.title) = 'admin'
  and not exists (
    select 1 from public.role_pages rp
    where rp.role_id = r.id and rp.pages = p.page
  );

-- Legacy unclaimed submissions had no claim code and could be claimed without one.
-- Lock them so they cannot be claimed with an empty code; teachers can re-link manually.
update public.students
set claim_code_hash = encode(gen_random_bytes(16), 'hex')
where user_id is null
  and claim_code_hash is null;

-- Hide score/remarks from students until the teacher releases feedback.
drop function if exists public.search_student_records(integer, text, text);
create function public.search_student_records(
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
  answers jsonb,
  feedback_released boolean
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
    case when coalesce(ak.release_feedback, false) then s.score else null end as score,
    case when coalesce(ak.release_feedback, false) then s.remarks else null end as remarks,
    s.answer_key_id,
    s.image_url,
    public.sanitize_student_answers(s.answers, coalesce(ak.release_feedback, false)) as answers,
    coalesce(ak.release_feedback, false) as feedback_released
  from public.students s
  left join public.answer_keys ak on ak.id = s.answer_key_id
  where s.answer_key_id = p_answer_key_id
    and nullif(trim(p_student_id), '') is not null
    and nullif(trim(p_fullname), '') is not null
    and lower(s.student_id) = lower(trim(p_student_id))
    and lower(s.fullname) = lower(trim(p_fullname))
  order by s.created_at desc
  limit 20
$$;

revoke all on function public.search_student_records(integer, text, text) from public;
grant execute on function public.search_student_records(integer, text, text) to anon, authenticated;

drop function if exists public.get_my_student_results();
create function public.get_my_student_results()
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
  needs_review boolean,
  feedback_released boolean
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
    case when coalesce(ak.release_feedback, false) then s.score else null end as score,
    case when coalesce(ak.release_feedback, false) then s.remarks else null end as remarks,
    s.answer_key_id,
    ak.title as quiz_title,
    ak.description as quiz_description,
    s.image_url,
    public.sanitize_student_answers(s.answers, coalesce(ak.release_feedback, false)) as answers,
    case when coalesce(ak.release_feedback, false) then s.needs_review else null end as needs_review,
    coalesce(ak.release_feedback, false) as feedback_released
  from public.students s
  left join public.answer_keys ak on ak.id = s.answer_key_id
  where s.user_id = auth.uid()
  order by s.created_at desc
$$;

revoke all on function public.get_my_student_results() from public, anon;
grant execute on function public.get_my_student_results() to authenticated;

alter table public.answer_keys
  alter column access_code set default upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));

update public.answer_keys
set access_code = default
where access_code is null or btrim(access_code) = '';

create or replace function public.ensure_answer_key_access_code()
returns trigger
language plpgsql
as $$
begin
  if new.access_code is null or btrim(new.access_code) = '' then
    new.access_code := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
  end if;
  return new;
end;
$$;

drop trigger if exists answer_keys_ensure_access_code on public.answer_keys;
create trigger answer_keys_ensure_access_code
before insert or update of access_code on public.answer_keys
for each row execute function public.ensure_answer_key_access_code();

drop function if exists public.teacher_relink_student_record(integer, uuid);
create function public.teacher_relink_student_record(p_student_id integer, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not (
    public.is_admin()
    or exists (
      select 1
      from public.students s
      join public.answer_keys ak on ak.id = s.answer_key_id
      where s.id = p_student_id
        and ak.created_by = auth.uid()
    )
  ) then
    raise exception 'Not allowed to manage this submission';
  end if;

  if p_user_id is null then
    raise exception 'Student account is required';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and nullif(u.app_metadata->>'role', '') is not null
      and exists (
        select 1
        from public.roles r
        where r.id = (u.app_metadata->>'role')::integer
          and lower(r.title) = 'student'
      )
  ) then
    raise exception 'A valid student account was not found';
  end if;

  update public.students
  set user_id = p_user_id,
      claim_code_hash = null
  where id = p_student_id;

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.teacher_relink_student_record(integer, uuid) from public, anon;
grant execute on function public.teacher_relink_student_record(integer, uuid) to authenticated;

drop function if exists public.teacher_clear_student_claim(integer);
create function public.teacher_clear_student_claim(p_student_id integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not (
    public.is_admin()
    or exists (
      select 1
      from public.students s
      join public.answer_keys ak on ak.id = s.answer_key_id
      where s.id = p_student_id
        and ak.created_by = auth.uid()
    )
  ) then
    raise exception 'Not allowed to manage this submission';
  end if;

  update public.students
  set claim_code_hash = null
  where id = p_student_id
    and user_id is null;

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.teacher_clear_student_claim(integer) from public, anon;
grant execute on function public.teacher_clear_student_claim(integer) to authenticated;

