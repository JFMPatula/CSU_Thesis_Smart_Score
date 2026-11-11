-- ============================================================
-- Pending account approval
-- Pending users keep their requested role in app_metadata, but
-- resolve to no role until an administrator sets status = 'active'.
-- ============================================================

create or replace function public.current_role_id()
returns integer
language sql
stable
as $$
  select case
    when lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'status', '')) = 'pending' then null
    else nullif(auth.jwt() -> 'app_metadata' ->> 'role', '')::integer
  end
$$;
