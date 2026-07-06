-- =============================================================
--  AMLAK ONE — Pipeline & KPI  |  Supabase schema
--  Run this in Supabase → SQL Editor (one shot).
--  Handles 3 roles: agent / leader / management, 150+ users.
-- =============================================================

-- ---------- TABLES ----------

create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  leader_id  uuid,                       -- profiles.id of the team leader
  created_at timestamptz default now()
);

-- profiles: one row per user, linked to Supabase Auth (auth.users)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  role       text not null default 'agent'
             check (role in ('agent','leader','management')),
  team_id    uuid references public.teams(id) on delete set null,
  active     boolean not null default true,
  created_at timestamptz default now()
);

-- reference data: the 14 daily KPIs and their targets
create table if not exists public.kpi_defs (
  key       text primary key,
  label     text not null,
  target    numeric not null,
  unit      text default '',
  direction text not null default 'up',  -- 'up' = higher better, 'down' = lower better
  sort      int not null
);

-- one row per agent per day; the 14 actuals live in `values` (jsonb)
create table if not exists public.kpi_entries (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.profiles(id) on delete cascade,
  entry_date date not null default current_date,
  values     jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (agent_id, entry_date)
);

-- one row per deal; lives for weeks and moves through stages
create table if not exists public.deals (
  id              uuid primary key default gen_random_uuid(),
  agent_id        uuid not null references public.profiles(id) on delete cascade,
  client          text not null default '',
  project         text default '',
  unit            text default '',
  value           numeric not null default 0,          -- AED
  stage           text not null default 'New Lead',
  probability     int  not null default 5,
  last_contact    date,
  next_followup   date,
  objection       text default '',
  blocker         text default '',
  manager_support boolean not null default false,
  next_action     text default '',
  expected_close  date,
  status          text not null default 'open'
                  check (status in ('open','won','lost')),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists idx_deals_agent   on public.deals(agent_id);
create index if not exists idx_deals_status  on public.deals(status);
create index if not exists idx_entries_agent on public.kpi_entries(agent_id);
create index if not exists idx_entries_date  on public.kpi_entries(entry_date);

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_deals_touch on public.deals;
create trigger trg_deals_touch before update on public.deals
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_entries_touch on public.kpi_entries;
create trigger trg_entries_touch before update on public.kpi_entries
  for each row execute function public.touch_updated_at();

-- ---------- HELPER FUNCTIONS (SECURITY DEFINER avoids RLS recursion) ----------
-- NB: never name a function current_role() — that's a reserved SQL function.

create or replace function public.app_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.app_team()
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid()
$$;

create or replace function public.agent_team(a uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = a
$$;

-- ---------- ROW LEVEL SECURITY ----------

alter table public.profiles    enable row level security;
alter table public.teams       enable row level security;
alter table public.kpi_defs    enable row level security;
alter table public.kpi_entries enable row level security;
alter table public.deals       enable row level security;

-- profiles: any signed-in user can read the roster (names/teams are not sensitive);
--           you may edit yourself, management may edit anyone.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_write on public.profiles;
create policy profiles_write on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.app_role() = 'management')
  with check (id = auth.uid() or public.app_role() = 'management');

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid() or public.app_role() = 'management');

-- teams + kpi_defs: everyone reads, management manages
drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select to authenticated using (true);
drop policy if exists teams_admin on public.teams;
create policy teams_admin on public.teams for all to authenticated
  using (public.app_role() = 'management') with check (public.app_role() = 'management');

drop policy if exists kpidefs_read on public.kpi_defs;
create policy kpidefs_read on public.kpi_defs for select to authenticated using (true);
drop policy if exists kpidefs_admin on public.kpi_defs;
create policy kpidefs_admin on public.kpi_defs for all to authenticated
  using (public.app_role() = 'management') with check (public.app_role() = 'management');

-- kpi_entries: agent owns own; leader reads own team; management reads all
drop policy if exists entries_select on public.kpi_entries;
create policy entries_select on public.kpi_entries for select to authenticated using (
  agent_id = auth.uid()
  or public.app_role() = 'management'
  or (public.app_role() = 'leader' and public.agent_team(agent_id) = public.app_team())
);
drop policy if exists entries_write on public.kpi_entries;
create policy entries_write on public.kpi_entries for insert to authenticated
  with check (agent_id = auth.uid());
drop policy if exists entries_update on public.kpi_entries;
create policy entries_update on public.kpi_entries for update to authenticated
  using (agent_id = auth.uid()) with check (agent_id = auth.uid());

-- deals: same visibility model
drop policy if exists deals_select on public.deals;
create policy deals_select on public.deals for select to authenticated using (
  agent_id = auth.uid()
  or public.app_role() = 'management'
  or (public.app_role() = 'leader' and public.agent_team(agent_id) = public.app_team())
);
drop policy if exists deals_insert on public.deals;
create policy deals_insert on public.deals for insert to authenticated
  with check (agent_id = auth.uid());
drop policy if exists deals_update on public.deals;
create policy deals_update on public.deals for update to authenticated
  using (agent_id = auth.uid()) with check (agent_id = auth.uid());
drop policy if exists deals_delete on public.deals;
create policy deals_delete on public.deals for delete to authenticated
  using (agent_id = auth.uid());

-- ---------- AUTO-CREATE A PROFILE ON SIGN-UP ----------
-- New auth users get an 'agent' profile automatically; management can promote later.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'agent')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- CRM EXPORT VIEW (flat rows, ready to sync out) ----------
create or replace view public.deal_export as
select d.id as deal_id, p.full_name as agent, t.name as team,
       d.client, d.project, d.unit, d.value as value_aed, d.stage,
       d.probability, d.status, d.expected_close, d.objection,
       d.manager_support, d.updated_at
from public.deals d
join public.profiles p on p.id = d.agent_id
left join public.teams t on t.id = p.team_id;

-- ---------- KPI REFERENCE DATA ----------
insert into public.kpi_defs (key,label,target,unit,direction,sort) values
  ('attendance','Attendance',100,'%','up',1),
  ('morning','Morning Meeting',100,'%','up',2),
  ('newLeads','New Leads Added',5,'','up',3),
  ('outbound','Outbound Calls',50,'','up',4),
  ('connected','Connected Calls',20,'','up',5),
  ('whatsapp','WhatsApp Chats',30,'','up',6),
  ('followupCalls','Follow-up Calls',20,'','up',7),
  ('qualified','Qualified Leads',5,'','up',8),
  ('meetingsBooked','Meetings Booked',2,'','up',9),
  ('meetingsDone','Meetings Completed',2,'','up',10),
  ('viewings','Property Viewings',1,'','up',11),
  ('offers','Offers Sent',1,'','up',12),
  ('negotiations','Negotiations',1,'','up',13),
  ('reservations','Reservations',1,'','up',14)
on conflict (key) do update set
  label=excluded.label, target=excluded.target, unit=excluded.unit,
  direction=excluded.direction, sort=excluded.sort;
