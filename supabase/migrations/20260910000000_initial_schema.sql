-- ============================================================
-- CSU-SmartScore — Initial Schema Migration
-- ============================================================

-- ----------------------------
-- 1. roles
-- ----------------------------
create table public.roles (
  id         integer generated always as identity primary key,
  created_at timestamptz not null default now(),
  title      text
);

-- ----------------------------
-- 2. role_pages
-- ----------------------------
create table public.role_pages (
  id         integer generated always as identity primary key,
  created_at timestamptz not null default now(),
  role_id    integer references public.roles(id) on delete cascade,
  pages      text
);

-- ----------------------------
-- 3. answer_keys
-- ----------------------------
create table public.answer_keys (
  id            integer generated always as identity primary key,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  title         text not null,
  description   text,
  qr_link       text not null,
  is_active     boolean not null default false,
  created_by    uuid references auth.users(id) on delete set null,
  answer_keys   jsonb,
  answer_images text
);

-- ----------------------------
-- 4. students
-- ----------------------------
create table public.students (
  id             integer generated always as identity primary key,
  created_at     timestamptz not null default now(),
  fullname       text not null,
  student_id     text not null,
  score          numeric,
  remarks        text,
  answer_key_id  integer references public.answer_keys(id) on delete set null,
  image_url      text,
  answers        jsonb
);

-- ----------------------------
-- 5. announcements
-- ----------------------------
create table public.announcements (
  id          integer generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  description text not null,
  image_url   text not null default ''
);

-- ----------------------------
-- Indexes
-- ----------------------------
create index idx_role_pages_role_id      on public.role_pages(role_id);
create index idx_answer_keys_created_by  on public.answer_keys(created_by);
create index idx_students_answer_key_id  on public.students(answer_key_id);
create index idx_announcements_user_id   on public.announcements(user_id);

-- ----------------------------
-- Row Level Security (RLS)
-- ----------------------------
alter table public.roles          enable row level security;
alter table public.role_pages     enable row level security;
alter table public.answer_keys    enable row level security;
alter table public.students       enable row level security;
alter table public.announcements  enable row level security;

-- Allow all users (anon + authenticated) full read access to roles and role_pages
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

-- Allow authenticated users full CRUD on answer_keys
create policy "Authenticated CRUD answer_keys"
  on public.answer_keys for all
  to authenticated
  using (true)
  with check (true);

-- Allow anonymous read on active answer_keys (for student quiz page)
create policy "Anonymous read active answer_keys"
  on public.answer_keys for select
  to anon
  using (is_active = true);

-- Allow authenticated users full CRUD on students
create policy "Authenticated CRUD students"
  on public.students for all
  to authenticated
  using (true)
  with check (true);

-- Allow anonymous insert on students (students submit answers)
create policy "Anonymous insert students"
  on public.students for insert
  to anon
  with check (true);

-- Allow anonymous read on students (students view their own results)
create policy "Anonymous read students"
  on public.students for select
  to anon
  using (true);

-- Allow authenticated users full CRUD on announcements
create policy "Authenticated CRUD announcements"
  on public.announcements for all
  to authenticated
  using (true)
  with check (true);

-- Allow anonymous read on announcements
create policy "Anonymous read announcements"
  on public.announcements for select
  to anon
  using (true);

-- ----------------------------
-- Storage Buckets
-- ----------------------------
insert into storage.buckets (id, name, public)
values
  ('answer_keys',     'answer_keys',     true),
  ('student-answers', 'student-answers', true),
  ('announcements',   'announcements',   true)
on conflict (id) do nothing;

-- Storage policies — authenticated can manage, anon can read
create policy "Authenticated upload answer_keys"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'answer_keys');

create policy "Authenticated manage answer_keys"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'answer_keys');

create policy "Anonymous read answer_keys"
  on storage.objects for select
  to anon
  using (bucket_id = 'answer_keys');

create policy "Authenticated upload student-answers"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'student-answers');

create policy "Authenticated manage student-answers"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'student-answers');

create policy "Anonymous read student-answers"
  on storage.objects for select
  to anon
  using (bucket_id = 'student-answers');

create policy "Authenticated upload announcements"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'announcements');

create policy "Authenticated manage announcements"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'announcements');

create policy "Anonymous read announcements"
  on storage.objects for select
  to anon
  using (bucket_id = 'announcements');

-- ----------------------------
-- Seed Data: Default Roles
-- ----------------------------
insert into public.roles (title) values
  ('Admin'),
  ('Teacher'),
  ('Student')
on conflict do nothing;

-- ----------------------------
-- Seed Data: Role Pages (Permissions)
-- ----------------------------
-- Admin permissions
insert into public.role_pages (role_id, pages)
select r.id, p.page
from public.roles r
cross join (values
  ('admin.dashboard.view'),
  ('admin.access'),
  ('admin.users.manage'),
  ('admin.roles.manage'),
  ('admin.announcements.manage')
) as p(page)
where r.title = 'Admin';

-- Teacher permissions
insert into public.role_pages (role_id, pages)
select r.id, p.page
from public.roles r
cross join (values
  ('teacher.access'),
  ('teacher.answerkey.manage'),
  ('teacher.students.view')
) as p(page)
where r.title = 'Teacher';
