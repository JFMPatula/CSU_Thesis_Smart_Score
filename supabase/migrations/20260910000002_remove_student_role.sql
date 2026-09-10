-- ============================================================
-- Remove Student role — only Admin and Teacher remain
-- ============================================================

-- Delete student's permission rows first (foreign key constraint)
delete from public.role_pages
where role_id = (select id from public.roles where title = 'Student');

-- Delete the Student role
delete from public.roles
where title = 'Student';
