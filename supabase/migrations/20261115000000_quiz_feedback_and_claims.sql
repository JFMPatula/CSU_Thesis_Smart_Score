-- ============================================================
-- Quiz feedback gating, optional access codes, and claim codes
-- ============================================================

-- Teachers decide when correct answers / AI explanations are visible.
alter table public.answer_keys
  add column if not exists release_feedback boolean not null default false,
  add column if not exists access_code text;

-- Anonymous submissions receive a one-time code that must be entered
-- before the record can be linked to a student account.
alter table public.students
  add column if not exists claim_code_hash text;

-- Students must read their results through get_my_student_results(), which
-- sanitizes unreleased grading fields. Direct table reads would expose them.
drop policy if exists "Students read own submissions" on public.students;

create or replace view public.answer_keys_public
with (security_invoker = false) as
select
  id,
  created_at,
  updated_at,
  title,
  description,
  qr_link,
  is_active,
  release_feedback,
  (access_code is not null and length(trim(access_code)) > 0) as requires_access_code
from public.answer_keys
where is_active = true;

revoke all on public.answer_keys_public from public;
grant select on public.answer_keys_public to anon, authenticated;

-- Strip grading fields from student-facing answer JSON until the teacher
-- releases feedback. Teachers read the raw students.answers column directly.
create or replace function public.sanitize_student_answers(p_answers jsonb, p_released boolean)
returns jsonb
language sql
immutable
as $$
  select case
    when p_answers is null then null
    when coalesce(p_released, false) then p_answers
    when jsonb_typeof(p_answers) = 'array' then (
      select coalesce(jsonb_agg(
        elem - 'isCorrect' - 'correctAnswer' - 'correctAnswerText'
             - 'aiExplanation' - 'aiConfidence' - 'gradedBy'
             - 'aiVerdict' - 'aiAutoAccepted' - 'reviewedVerdict'
             - 'needsReview'
      ), '[]'::jsonb)
      from jsonb_array_elements(p_answers) elem
    )
    when jsonb_typeof(p_answers) = 'object' then (
      select coalesce(jsonb_object_agg(
        key,
        case
          when jsonb_typeof(value) = 'object' then
            value - 'isCorrect' - 'correctAnswer' - 'correctAnswerText'
                  - 'aiExplanation' - 'aiConfidence' - 'gradedBy'
                  - 'aiVerdict' - 'aiAutoAccepted' - 'reviewedVerdict'
                  - 'needsReview'
          else value
        end
      ), '{}'::jsonb)
      from jsonb_each(p_answers)
    )
    else p_answers
  end
$$;

revoke all on function public.sanitize_student_answers(jsonb, boolean) from public, anon, authenticated;

-- Public result search: only return answer details after feedback release.
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
    s.score,
    s.remarks,
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

-- Authenticated students' own results use the same sanitization.
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
    s.score,
    s.remarks,
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

-- Claiming requires a confirmed email. New anonymous submissions also
-- require the one-time claim code shown at submission time.
drop function if exists public.claim_student_records(text, text);
drop function if exists public.claim_student_records(text, text, text);
create function public.claim_student_records(
  p_student_id text,
  p_fullname text,
  p_claim_code text default null
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
  v_hash text;
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

  if not exists (
    select 1
    from auth.users u
    where u.id = v_uid
      and u.email_confirmed_at is not null
  ) then
    raise exception 'Please confirm your email before claiming results';
  end if;

  if nullif(trim(p_student_id), '') is null or nullif(trim(p_fullname), '') is null then
    raise exception 'Student ID and full name are required';
  end if;

  v_hash := encode(sha256(convert_to(upper(trim(coalesce(p_claim_code, ''))), 'UTF8')), 'hex');

  update public.students s
  set user_id = v_uid
  where s.user_id is null
    and lower(trim(s.student_id)) = lower(trim(p_student_id))
    and lower(trim(s.fullname)) = lower(trim(p_fullname))
    and (s.claim_code_hash is null or s.claim_code_hash = v_hash);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_student_records(text, text, text) from public, anon;
grant execute on function public.claim_student_records(text, text, text) to authenticated;
