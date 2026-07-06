# Amlak One — Pipeline & KPI on Supabase

A live, multi-user web app for 150+ agents. Three roles — **agent**, **team leader**,
**management** — with the data each role is allowed to see enforced by the database itself
(Postgres Row Level Security), not by the app. That's the part that makes it safe at scale.

---

## What you're deploying

- **Supabase** — database, logins, and the live API (free tier is fine to start; Pro ~$25/mo when you grow).
- **This React app** — the front end agents open on their phone. Hosted on **Vercel** (free).

Data model, deliberately two linked tables:
- `kpi_entries` — one row per agent per day (the 14 daily activity KPIs).
- `deals` — one row per deal, lives for weeks, moves through 13 stages, carries AED value.

Everything else (`profiles`, `teams`, `kpi_defs`) is supporting structure. A ready-made
`deal_export` view gives you clean flat rows to sync into a CRM later.

---

## Setup — about 30 minutes

### 1. Create the Supabase project
1. Go to supabase.com → **New project**. Pick a region near the UAE (e.g. Frankfurt or Mumbai) for speed.
2. Wait for it to finish provisioning.

### 2. Build the database
1. Open **SQL Editor** → **New query**.
2. Paste the entire contents of `schema.sql` and click **Run**.
   This creates every table, the security rules, the sign-up trigger, and loads the 14 KPI targets.
   It's safe to re-run.

### 3. Create your teams and users
**Teams** (SQL Editor):
```sql
insert into teams (name) values ('Team Omnia'), ('Team Karam'), ('Team Nicola');
```

**Users** — Authentication → **Add user** (or invite by email). Each new user automatically
gets an `agent` profile. Then promote leaders and management and assign teams. Grab the team
IDs with `select id, name from teams;`, then:
```sql
-- make someone management
update profiles set role = 'management' where full_name = 'Your Name';

-- make a team leader and put them on a team
update profiles set role = 'leader', team_id = '<team-uuid>' where full_name = 'Omnia';
-- point the team's leader_id at them too (optional, for reference)
update teams set leader_id = (select id from profiles where full_name='Omnia') where name='Team Omnia';

-- assign an agent to a team
update profiles set team_id = '<team-uuid>' where full_name = 'Ahmed';
```

> How access works, so you can trust it: a leader can only ever read rows for agents whose
> `team_id` matches their own. Management reads everything. Agents read and write only their own.
> This is enforced in the database — even someone poking at the API directly can't see more than
> their role allows.

### 4. Run the app locally (to test)
```bash
npm install
cp .env.example .env      # then paste your URL + anon key from Supabase → Settings → API
npm run dev
```
Open the local URL, sign in as one of your users, and confirm the right view loads.

### 5. Deploy (shareable link)
1. Push this folder to a GitHub repo.
2. vercel.com → **New Project** → import the repo.
3. Add the two environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
4. **Deploy.** You get a URL like `amlak-pipeline.vercel.app` — that's the link agents open on their phones.
5. In Supabase → Authentication → **URL Configuration**, add your Vercel URL to the allowed list.

---

## Day-to-day

- **Agents** open the link, enter today's KPIs with the +/– steppers (auto-saves), and manage
  their own deals. "Flag for manager support" raises a deal to their leader.
- **Team leaders** see their team's KPI scorecard, flagged deals, and pipeline by stage — live.
- **Management** sees company pipeline, weighted forecast, the activity funnel, the agent
  leaderboard, and can **Export CSV**. Dashboards update in real time as agents enter data.

**Weighted forecast** (deal value × probability) is the headline number to manage on — total
pipeline flatters everyone; weighted is what you'll actually close.

---

## Feeding a CRM later

Two clean paths, both off the `deal_export` view:
- **Pull**: the CRM (or a scheduled job) reads `deal_export` via the Supabase API.
- **Push**: a Supabase Edge Function on deal-change posts to your CRM's API.

Because deal fields already map to standard CRM concepts (client, value, stage, probability,
expected close), the mapping is straightforward when you pick the CRM.

---

## Cost at 150 agents
Supabase Pro (~$25/mo) comfortably covers this workload; Vercel stays free at this scale.
Start on free tiers, upgrade Supabase to Pro before rollout for the daily backups and headroom.
