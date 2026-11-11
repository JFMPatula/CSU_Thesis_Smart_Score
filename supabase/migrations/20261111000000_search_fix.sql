-- ============================================================
-- Require both Student ID and Full Name for public student lookups
-- ============================================================

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
    and nullif(trim(p_student_id), '') is not null
    and nullif(trim(p_fullname), '') is not null
    and lower(s.student_id) = lower(trim(p_student_id))
    and lower(s.fullname) = lower(trim(p_fullname))
  order by s.created_at desc
  limit 20
$$;

revoke all on function public.search_student_records(integer, text, text) from public;
grant execute on function public.search_student_records(integer, text, text) to anon, authenticated;
