-- FILE: supabase/migrations/20251120160000_create_sales_tables.sql
-- Purpose:
--   Phase 1 foundation for Atlas Command internal Sales Engine (/sales)
--   - Creates sales_leads (core pipeline table)
--   - Creates sales_lead_stages (lookup for stage definitions)
--   - Creates sales_settings (per-org feature flag)
--   - Adds RLS so everything is org-scoped via current_org_id()
--
-- IMPORTANT:
--   - This migration ONLY creates new tables, functions, and policies.
--   - It does NOT alter any existing tables, RLS policies, or security.

------------------------------------------------------------
-- 1) Helper: generic updated_at trigger function
------------------------------------------------------------

-- If you already have a similar function in your schema, you can skip this
-- block. Otherwise, this will create a simple reusable function.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
'Trigger helper to automatically bump updated_at on row updates.';

------------------------------------------------------------
-- 2) Table: sales_leads (core pipeline table)
------------------------------------------------------------

create table public.sales_leads (
  id uuid primary key default gen_random_uuid(),

  -- Multi-tenant isolation
  org_id uuid not null
    references public.organizations (id) on delete cascade,

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references auth.users (id),
  updated_by uuid null references auth.users (id),

  -- Lead source & basic info
  source text not null default 'manual', -- e.g. 'manual', 'fmcsa', 'import', 'ai_enriched'
  carrier_name text not null,

  -- FMCSA / identifiers (future V2 enrichment)
  dot_number text null,
  mc_number text null,

  -- Contact info
  primary_contact_name text null,
  primary_contact_email text null,
  primary_contact_phone text null,
  website text null,

  -- Location
  city text null,
  state text null,
  postal_code text null,
  country text null default 'US',

  -- Carrier size / profile
  fleet_size integer null,       -- from FMCSA or manual
  lane_focus text null,          -- free-form notes about lanes

  -- Pipeline stage
  stage text not null default 'NEW',
  stage_changed_at timestamptz not null default now(),

  -- Outcome / status
  status_reason text null,       -- e.g. why lost/disqualified
  notes text null,               -- general notes about this lead
  tags text[] not null default '{}', -- tags like {'dry-van','west'}

  -- Archiving
  is_archived boolean not null default false
);

comment on table public.sales_leads is
'Atlas internal sales pipeline: carrier-level leads scoped per org.';

comment on column public.sales_leads.org_id is
'Organization that owns this lead. Enforced via RLS using current_org_id().';

comment on column public.sales_leads.stage is
'Pipeline stage: NEW, CONTACTED, ENGAGED, DEMO, CLOSED_WON, CLOSED_LOST.';


-- Indexes to keep queries fast (especially per-org, per-stage)
create index sales_leads_org_stage_idx
  on public.sales_leads (org_id, stage);

create index sales_leads_org_carrier_name_idx
  on public.sales_leads (org_id, lower(carrier_name));

create index sales_leads_org_dot_idx
  on public.sales_leads (org_id, dot_number);

------------------------------------------------------------
-- 2a) Trigger: auto-update updated_at on sales_leads
------------------------------------------------------------

create trigger sales_leads_set_updated_at
before update on public.sales_leads
for each row
execute procedure public.set_updated_at();


------------------------------------------------------------
-- 3) Table: sales_lead_stages (lookup for stages)
------------------------------------------------------------

create table public.sales_lead_stages (
  id uuid primary key default gen_random_uuid(),

  -- Multi-tenant isolation
  org_id uuid not null
    references public.organizations (id) on delete cascade,

  -- Stage definition
  key text not null,          -- internal key: NEW, CONTACTED, etc.
  label text not null,        -- display label
  order_index integer not null default 0,
  color text null,            -- optional: e.g. 'emerald', 'amber', 'slate'
  is_default boolean not null default false,

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sales_lead_stages is
'Per-org pipeline stage definitions for the sales engine.';

comment on column public.sales_lead_stages.key is
'Internal stage key (e.g., NEW, CONTACTED, ENGAGED, DEMO, CLOSED_WON, CLOSED_LOST).';

create unique index sales_lead_stages_org_key_uniq
  on public.sales_lead_stages (org_id, key);


------------------------------------------------------------
-- 3a) Trigger: auto-update updated_at on sales_lead_stages
------------------------------------------------------------

create trigger sales_lead_stages_set_updated_at
before update on public.sales_lead_stages
for each row
execute procedure public.set_updated_at();


------------------------------------------------------------
-- 4) Table: sales_settings (per-org toggle for sales engine)
------------------------------------------------------------

create table public.sales_settings (
  id uuid primary key default gen_random_uuid(),

  -- Multi-tenant isolation (one row per org recommended)
  org_id uuid not null
    references public.organizations (id) on delete cascade,

  sales_enabled boolean not null default false,
  owner_user_id uuid null references auth.users (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sales_settings_org_unique unique (org_id)
);

comment on table public.sales_settings is
'Per-org feature toggle and configuration for the Atlas sales engine.';


------------------------------------------------------------
-- 4a) Trigger: auto-update updated_at on sales_settings
------------------------------------------------------------

create trigger sales_settings_set_updated_at
before update on public.sales_settings
for each row
execute procedure public.set_updated_at();


------------------------------------------------------------
-- 5) RLS: enable and lock tables to current_org_id()
------------------------------------------------------------

-- Enable row level security
alter table public.sales_leads       enable row level security;
alter table public.sales_lead_stages enable row level security;
alter table public.sales_settings    enable row level security;

-- Sales Leads: org-scoped access
create policy "sales_leads_org_scope"
  on public.sales_leads
  for all
  using (org_id = current_org_id())
  with check (org_id = current_org_id());

-- Sales Lead Stages: org-scoped access
create policy "sales_lead_stages_org_scope"
  on public.sales_lead_stages
  for all
  using (org_id = current_org_id())
  with check (org_id = current_org_id());

-- Sales Settings: org-scoped access
create policy "sales_settings_org_scope"
  on public.sales_settings
  for all
  using (org_id = current_org_id())
  with check (org_id = current_org_id());


------------------------------------------------------------
-- 6) Grants: authenticated role (RLS still enforced)
------------------------------------------------------------

grant select, insert, update, delete
  on public.sales_leads
  to authenticated;

grant select, insert, update, delete
  on public.sales_lead_stages
  to authenticated;

grant select, insert, update, delete
  on public.sales_settings
  to authenticated;
