-- ============================================================
-- Fix: Allow anonymous read on roles and role_pages
-- (needed for the registration form role dropdown)
-- ============================================================

-- Drop the old authenticated-only select policies
drop policy if exists "Authenticated read roles"      on public.roles;
drop policy if exists "Authenticated read role_pages"  on public.role_pages;

-- Allow anyone (anon + authenticated) to read roles and role_pages
create policy "Anyone read roles"
  on public.roles for select
  using (true);

create policy "Anyone read role_pages"
  on public.role_pages for select
  using (true);

-- Allow authenticated users to manage roles and role_pages
create policy "Authenticated manage roles"
  on public.roles for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated manage role_pages"
  on public.role_pages for all
  to authenticated
  using (true)
  with check (true);
