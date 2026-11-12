-- SPN Phase 1: additive partner/referral foundations. No existing rows deleted.
-- Existing partner, enquiry and booking IDs remain authoritative.
alter table public.partner add column if not exists partner_code text;
alter table public.partner add column if not exists approved_at timestamptz;
alter table public.partner add column if not exists agreement_accepted_at timestamptz;
create unique index if not exists partner_code_unique on public.partner (upper(partner_code)) where partner_code is not null;

create table if not exists public.partner_referral (
 id uuid primary key default gen_random_uuid(),
 partner_id uuid not null references public.partner(id) on delete restrict,
 enquiry_id uuid references public.enquiry(id) on delete set null,
 booking_id uuid references public.booking(id) on delete set null,
 client_id uuid references public.client(id) on delete set null,
 referral_token uuid not null default gen_random_uuid() unique,
 channel text not null default 'partner_link',
 status text not null default 'captured' check (status in ('captured','qualified','converted','expired','disputed','invalid')),
 first_seen_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '30 days'),
 created_by uuid references public.app_user(id) on delete set null,
 notes text not null default '',
 constraint referral_valid_window check (expires_at > first_seen_at)
);
create index if not exists partner_referral_partner_idx on public.partner_referral(partner_id,first_seen_at desc);
create index if not exists partner_referral_enquiry_idx on public.partner_referral(enquiry_id);
create unique index if not exists partner_referral_booking_unique on public.partner_referral(booking_id) where booking_id is not null;
-- Unique booking claim prevents competing partner commission attribution.

create table if not exists public.partner_commission_entry (
 id uuid primary key default gen_random_uuid(),
 booking_id uuid not null references public.booking(id) on delete restrict,
 partner_id uuid not null references public.partner(id) on delete restrict,
 kind text not null check (kind in ('direct','leader','repeat','adjustment')),
 policy_version text not null,
 rate_pct numeric(5,2) not null check (rate_pct between 0 and 100),
 basis_pesewas bigint not null check (basis_pesewas >= 0),
 amount_pesewas bigint not null,
 status text not null default 'pending' check (status in ('pending','verified','approved','paid','reversed','disputed')),
 created_at timestamptz not null default now(),
 approved_at timestamptz,
 approved_by uuid references public.app_user(id) on delete set null,
 memo text not null default ''
);
create unique index if not exists partner_commission_one_direct on public.partner_commission_entry(booking_id) where kind='direct';
create unique index if not exists partner_commission_one_leader on public.partner_commission_entry(booking_id) where kind='leader';
create index if not exists partner_commission_partner_idx on public.partner_commission_entry(partner_id,created_at desc);

alter table public.partner_referral enable row level security;
alter table public.partner_commission_entry enable row level security;
-- Existing staff permissions only; external partner login deliberately deferred.
create policy spn_referral_read on public.partner_referral for select to authenticated using (public.is_staff());
create policy spn_referral_insert on public.partner_referral for insert to authenticated with check (public.is_staff());
create policy spn_referral_update on public.partner_referral for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy spn_commission_read on public.partner_commission_entry for select to authenticated using (public.is_owner());
create policy spn_commission_write on public.partner_commission_entry for insert to authenticated with check (public.is_owner());
create policy spn_commission_update on public.partner_commission_entry for update to authenticated using (public.is_owner()) with check (public.is_owner());
grant select,insert,update on public.partner_referral to authenticated;
grant select,insert,update on public.partner_commission_entry to authenticated;
-- Deliberately no DELETE grants or DELETE policies.
create trigger spn_referral_audit after insert or update on public.partner_referral for each row execute function public.audit_change();
create trigger spn_commission_audit after insert or update on public.partner_commission_entry for each row execute function public.audit_change();
