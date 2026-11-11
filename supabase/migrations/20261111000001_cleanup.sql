-- Backfill ownership for legacy answer keys that predate created_by tracking.
-- Only touches rows with no owner, so existing ownership is preserved.
update public.answer_keys
set created_by = '9e6aa7ad-a2d0-4ec4-8568-3c812cf087fc'
where created_by is null
  and exists (
    select 1 from auth.users
    where id = '9e6aa7ad-a2d0-4ec4-8568-3c812cf087fc'
  );
