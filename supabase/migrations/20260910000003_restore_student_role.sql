-- ============================================================
-- Revert: Restore Student role
-- ============================================================

-- Insert Student; identity will assign next available ID
insert into public.roles (title) values ('Student');

-- Get the assigned ID and reset sequence to maintain continuity
do $$
declare
  new_id integer;
begin
  select id into new_id from public.roles where title = 'Student';
  raise notice 'Student role assigned ID: %', new_id;
end $$;

-- Add student permission pages
insert into public.role_pages (role_id, pages)
select r.id, p.page
from public.roles r
cross join (values
  ('student.quiz.access')
) as p(page)
where r.title = 'Student';
