import {
  SUPABASE_SESSION_SNAPSHOT_BUCKET,
  SUPABASE_SYNC_SCHEMA_VERSION,
} from "@src/store/collaboration/types";

// Schema v2. Credential model: org_secret (root, admin ops only), invite_code
// (single-purpose join ticket), member_token (per-member, revocable — hash in
// orgii_members.credential_hash). Every RPC authenticates through
// orgii_authenticate with exactly one credential kind. Auth and lookup
// failures all raise the same opaque ORGII_UNAUTHORIZED so anon callers get
// no existence oracle. Deletes are tombstones (deleted_at) so removals
// propagate through the updated_at delta.
//
// Migration discipline: every block is idempotent (create if not exists /
// alter add column if not exists / drop+create functions); the final insert
// stamps the version row. Re-running the whole script upgrades a v1 database.
export const ORGII_SUPABASE_SETUP_SQL = `create extension if not exists pgcrypto;

-- ============================================================ tables

create table if not exists public.orgii_sync_meta (
  schema_version integer primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.orgii_orgs (
  id text primary key,
  name text not null,
  secret_hash text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.orgii_members (
  id text not null,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  display_name text not null,
  identity_kind text not null,
  role text not null,
  payload jsonb not null,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (org_id, id)
);

alter table public.orgii_members
  add column if not exists credential_hash text;

create table if not exists public.orgii_invites (
  id text primary key,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  invite_code_hash text not null unique,
  usage_limit integer not null default 10,
  usage_count integer not null default 0,
  expires_at timestamptz,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.orgii_invites
  add column if not exists role text not null default 'member',
  add column if not exists created_by_member_id text,
  add column if not exists revoked_by_member_id text;

create table if not exists public.orgii_projects (
  id text primary key,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.orgii_projects
  add column if not exists slug text,
  add column if not exists name text,
  add column if not exists status text,
  add column if not exists priority text,
  add column if not exists health text,
  add column if not exists lead_member_id text,
  add column if not exists description text,
  add column if not exists start_date text,
  add column if not exists target_date text,
  add column if not exists work_item_prefix text,
  add column if not exists next_work_item_id integer not null default 1,
  add column if not exists version integer not null default 0,
  add column if not exists updated_by_member_id text,
  add column if not exists deleted_at timestamptz;

create table if not exists public.orgii_work_items (
  id text primary key,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.orgii_work_items
  add column if not exists project_id text,
  add column if not exists short_id text,
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists status text,
  add column if not exists priority text,
  add column if not exists assignee_member_id text,
  add column if not exists assignee_type text,
  add column if not exists milestone text,
  add column if not exists parent_id text,
  add column if not exists start_date text,
  add column if not exists target_date text,
  add column if not exists version integer not null default 0,
  add column if not exists updated_by_member_id text,
  add column if not exists deleted_at timestamptz;

create table if not exists public.orgii_sessions (
  id text primary key,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  owner_member_id text not null,
  source_session_id text not null,
  access_mode text,
  payload jsonb not null,
  -- Segments summary (design §7.3): the OCC anchors + change signal for the
  -- frozen/tail event data plane. All null until the owner pushes segments.
  events_epoch integer,
  events_frozen_seq integer,
  events_count integer,
  events_tail_hash text,
  events_updated_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.orgii_sessions
  add column if not exists deleted_at timestamptz,
  add column if not exists events_epoch integer,
  add column if not exists events_frozen_seq integer,
  add column if not exists events_count integer,
  add column if not exists events_tail_hash text;

-- Sharing plane (design §6.2): visibility 'org' | 'restricted' (null on
-- pre-M4 rows reads as 'org' in every filter — those rows were org-visible
-- all along), replay_level 'metadata' | 'replay'. Both are derived from the
-- owner's effective access mode at push time; the server never backfills.
alter table public.orgii_sessions
  add column if not exists visibility text,
  add column if not exists replay_level text;

-- Legacy Storage-blob pointers, replaced by the segments plane.
alter table public.orgii_sessions
  drop column if exists events_blob_path,
  drop column if exists events_content_hash;

-- Event segments (design §7.3): immutable frozen prefix as numbered
-- append-only segments plus a single mutable tail row (seq = 1e9, replaced
-- in place). payload_gz is client-gzipped JSON of the segment's event array;
-- PostgREST transports it base64-encoded. Rows die with the sessions row
-- (cascade) or via explicit deletes in tombstone / rewrite / GC paths.
create table if not exists public.orgii_session_event_segments (
  org_id text not null,
  session_row_id text not null references public.orgii_sessions(id) on delete cascade,
  epoch integer not null,
  seq integer not null,
  is_tail boolean not null default false,
  payload_gz bytea not null,
  event_count integer not null,
  segment_hash text not null,
  created_at timestamptz not null default now(),
  primary key (org_id, session_row_id, epoch, seq)
);

-- Session shares (design §6.2): per-session grants that ADD visibility on
-- top of the org default — share is additive-only. Exactly one of
-- grantee_member_id (directed share) and share_token_hash (link capability,
-- sha256 of a token that exists only on the owner's client) is set per row.
-- Revocation keeps the row (owner audit trail); every filter treats revoked
-- or expired rows as absent. session_row_id references the globally unique
-- sessions.id ('org:member:session'), never the bare source_session_id (two
-- members may hold the same source id).
create table if not exists public.orgii_session_shares (
  id text primary key,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  session_row_id text not null references public.orgii_sessions(id) on delete cascade,
  owner_member_id text not null,
  grantee_member_id text,
  share_token_hash text unique,
  level text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.orgii_chat_messages (
  id text primary key,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  author_member_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.orgii_session_snapshot_requests (
  request_id text primary key,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  requester_member_id text not null,
  owner_member_id text not null,
  source_session_id text not null,
  status text not null,
  error text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orgii_session_snapshots (
  request_id text primary key references public.orgii_session_snapshot_requests(request_id) on delete cascade,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  source_session_id text not null,
  -- Snapshot payload ({session, events}) as client-gzipped JSON. Replaces
  -- the retired Storage-bucket blob (blob_path / content_hash).
  payload_gz bytea,
  metadata jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.orgii_session_snapshots
  add column if not exists payload_gz bytea;

alter table public.orgii_session_snapshots
  drop column if exists blob_path,
  drop column if exists content_hash;

create table if not exists public.orgii_repo_join_requests (
  request_id text primary key,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  requester_member_id text not null,
  repo_path text not null,
  status text not null default 'pending',
  reviewer_member_id text,
  review_note text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.orgii_sync_meta enable row level security;
alter table public.orgii_orgs enable row level security;
alter table public.orgii_members enable row level security;
alter table public.orgii_invites enable row level security;
alter table public.orgii_projects enable row level security;
alter table public.orgii_work_items enable row level security;
alter table public.orgii_sessions enable row level security;
alter table public.orgii_session_event_segments enable row level security;
alter table public.orgii_session_shares enable row level security;
alter table public.orgii_chat_messages enable row level security;
alter table public.orgii_session_snapshot_requests enable row level security;
alter table public.orgii_session_snapshots enable row level security;
alter table public.orgii_repo_join_requests enable row level security;

-- Storage bucket RETIRED (design §7.1 / S5): every events/snapshot payload
-- now travels through member-authenticated RPCs into Postgres bytea. The
-- bucket row is kept (harmless, and dropping user data buckets is not ours
-- to do) but all anon policies are dropped and never recreated — with no
-- policy, anon can neither list nor read objects.
do $$
begin
  if not exists (select 1 from storage.buckets where id = '${SUPABASE_SESSION_SNAPSHOT_BUCKET}') then
    insert into storage.buckets (id, name, public)
    values ('${SUPABASE_SESSION_SNAPSHOT_BUCKET}', '${SUPABASE_SESSION_SNAPSHOT_BUCKET}', false);
  end if;
end $$;

drop policy if exists orgii_snapshots_anon_read on storage.objects;
drop policy if exists orgii_snapshots_anon_insert on storage.objects;
drop policy if exists orgii_snapshots_anon_update on storage.objects;

-- ============================================================ drop v1 functions
-- v1 signatures are dropped explicitly: create-or-replace with different
-- arguments would create overloads, leaving the insecure v1 entry points live.

drop function if exists public.orgii_validate_org_secret(text, text);
drop function if exists public.orgii_create_org(text, text, text, text, jsonb, jsonb);
drop function if exists public.orgii_create_invite(text, text, text, integer, timestamptz, jsonb);
drop function if exists public.orgii_accept_invite(text, text, text, jsonb);
drop function if exists public.orgii_remove_member(text, text, text);
drop function if exists public.orgii_upsert_member(text, jsonb);
drop function if exists public.orgii_upsert_project(text, text, jsonb);
drop function if exists public.orgii_upsert_work_item(text, text, jsonb);
drop function if exists public.orgii_upsert_session_metadata(text, jsonb);
drop function if exists public.orgii_remove_session_metadata(text, text, text, text);
drop function if exists public.orgii_post_chat_message(text, jsonb);
drop function if exists public.orgii_request_session_snapshot(text, jsonb);
drop function if exists public.orgii_create_session_snapshot(text, text, text, text, jsonb, text, text);
drop function if exists public.orgii_deny_session_snapshot(text, text, text);
drop function if exists public.orgii_upsert_session_events(text, text, text, text, text);
drop function if exists public.orgii_get_session_events(text, text, text);
drop function if exists public.orgii_update_org_repo_scopes(text, text, text[]);
drop function if exists public.orgii_request_repo_join(text, text, text, text, jsonb);
drop function if exists public.orgii_review_repo_join(text, text, boolean, text, text);
drop function if exists public.orgii_list_org_state(text, text, timestamptz);

-- v2.0 signatures (auth params led the argument list, blocking PostgREST
-- default-omission and later renames): drop before recreating.
drop function if exists public.orgii_create_invite(text, text, text, text, text, integer, timestamptz, text, jsonb);
drop function if exists public.orgii_revoke_invite(text, text, text, text, text);
drop function if exists public.orgii_remove_member(text, text, text, text, text);
drop function if exists public.orgii_update_member_role(text, text, text, text, text, text);
drop function if exists public.orgii_upsert_session_metadata(text, text, text, jsonb);
drop function if exists public.orgii_remove_session_metadata(text, text, text, text, text, text);
drop function if exists public.orgii_upsert_session_events(text, text, text, text, text, text);
drop function if exists public.orgii_get_session_events(text, text, text, text, text);
drop function if exists public.orgii_post_chat_message(text, text, text, jsonb);
drop function if exists public.orgii_upsert_project(text, text, text, text, jsonb, integer);
drop function if exists public.orgii_delete_project(text, text, text, text, text);
drop function if exists public.orgii_upsert_work_item(text, text, text, text, jsonb, integer);
drop function if exists public.orgii_delete_work_item(text, text, text, text, text);
drop function if exists public.orgii_request_session_snapshot(text, text, text, jsonb);
drop function if exists public.orgii_create_session_snapshot(text, text, text, text, text, jsonb, text, text);
drop function if exists public.orgii_deny_session_snapshot(text, text, text, text, text);
drop function if exists public.orgii_update_org_repo_scopes(text, text, text, text, text[]);
drop function if exists public.orgii_request_repo_join(text, text, text, text, jsonb);
drop function if exists public.orgii_review_repo_join(text, text, text, text, text, boolean, text);
drop function if exists public.orgii_list_org_state(text, text, text, text, timestamptz);

-- M3 (segments data plane): the blob-era events RPCs are removed for good —
-- their drop statements above stay so re-runs purge them from live DBs —
-- and the snapshot publish RPC changes signature (payload_gz replaces
-- blob_path + content_hash).
drop function if exists public.orgii_create_session_snapshot(text, text, text, jsonb, text, text, text, text);

-- M4 (sharing plane): orgii_get_session_event_segments gains p_share_token;
-- drop the M3 signature so the old overload cannot linger next to it.
drop function if exists public.orgii_get_session_event_segments(text, text, integer, text, text, text);

-- M6 (project/work-item collab sync): allocator + execution-lock RPCs.
-- Dropped before (re)creation so a future signature change can never leave
-- a stale overload behind.
drop function if exists public.orgii_allocate_work_item_short_id(text, text, text, text, text);
drop function if exists public.orgii_acquire_work_item_lock(text, text, jsonb, text, text, text);
drop function if exists public.orgii_release_work_item_lock(text, text, text, text, text);

-- ============================================================ auth

create or replace function public.orgii_sync_version()
returns integer
language sql
security definer
set search_path = public, extensions
as $$
  select max(schema_version) from public.orgii_sync_meta;
$$;

create or replace function public.orgii_authenticate(
  p_org_id text,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns table (member_id text, member_role text, is_root boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_has_member boolean := p_member_id is not null and p_member_token is not null;
  v_has_secret boolean := p_org_secret is not null and length(trim(p_org_secret)) > 0;
  v_member record;
begin
  if v_has_member = v_has_secret then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  if v_has_secret then
    if exists (
      select 1 from public.orgii_orgs
      where id = p_org_id
        and secret_hash = encode(digest(p_org_secret, 'sha256'), 'hex')
    ) then
      return query select null::text, 'admin'::text, true;
      return;
    end if;
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  select m.* into v_member
  from public.orgii_members m
  where m.org_id = p_org_id
    and m.id = p_member_id
    and m.credential_hash is not null
    and m.credential_hash = encode(digest(p_member_token, 'sha256'), 'hex')
    and m.removed_at is null;

  if v_member.id is null then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  return query select v_member.id, v_member.role, false;
end;
$$;

create or replace function public.orgii_authenticate_admin(
  p_org_id text,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns table (member_id text, is_root boolean)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, p_org_secret);
  if not (v_ctx.is_root or v_ctx.member_role = 'admin') then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;
  return query select v_ctx.member_id, v_ctx.is_root;
end;
$$;

-- ============================================================ org / members / invites

create or replace function public.orgii_create_org(
  org_name text,
  display_name text,
  identity_kind text,
  org_secret_hash text,
  member_credential_hash text,
  payload jsonb,
  member_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  next_org_id text := coalesce(payload->>'id', gen_random_uuid()::text);
  next_member_id text := coalesce(member_payload->>'id', gen_random_uuid()::text);
  -- Secrets never land in the stored payload: v1 stored the plaintext org
  -- secret + anon key here and served them to every member via list.
  v_org_payload jsonb := (payload - 'orgSecret' - 'supabaseAnonKey' - 'memberToken');
begin
  insert into public.orgii_orgs (id, name, secret_hash, payload)
  values (next_org_id, org_name, org_secret_hash, jsonb_set(v_org_payload, '{id}', to_jsonb(next_org_id), true));

  insert into public.orgii_members (id, org_id, display_name, identity_kind, role, credential_hash, payload)
  values (
    next_member_id,
    next_org_id,
    display_name,
    identity_kind,
    'admin',
    member_credential_hash,
    jsonb_set(jsonb_set(member_payload, '{id}', to_jsonb(next_member_id), true), '{orgId}', to_jsonb(next_org_id), true)
  );

  return jsonb_build_object(
    'org', (select o.payload from public.orgii_orgs o where o.id = next_org_id),
    'member', (select m.payload from public.orgii_members m where m.org_id = next_org_id and m.id = next_member_id)
  );
end;
$$;

create or replace function public.orgii_accept_invite(
  invite_code text,
  display_name text,
  identity_kind text,
  member_credential_hash text,
  member_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  next_member_id text := coalesce(member_payload->>'id', gen_random_uuid()::text);
  v_org_id text;
  v_role text;
begin
  -- Atomic claim: the usage slot is decremented in the same statement that
  -- gates membership, so N concurrent accepts on a 1-use invite admit one.
  with claimed as (
    update public.orgii_invites
       set usage_count = usage_count + 1,
           payload = jsonb_set(payload, '{usageCount}', to_jsonb(usage_count + 1), true)
     where invite_code_hash = encode(digest(invite_code, 'sha256'), 'hex')
       and revoked_at is null
       and (expires_at is null or expires_at > now())
       and usage_count < usage_limit
     returning org_id, role
  )
  select claimed.org_id, claimed.role into v_org_id, v_role from claimed;

  if v_org_id is null then
    raise exception 'ORGII_INVITE_INVALID';
  end if;

  insert into public.orgii_members (id, org_id, display_name, identity_kind, role, credential_hash, payload)
  values (
    next_member_id,
    v_org_id,
    display_name,
    identity_kind,
    coalesce(v_role, 'member'),
    member_credential_hash,
    jsonb_set(jsonb_set(member_payload, '{id}', to_jsonb(next_member_id), true), '{orgId}', to_jsonb(v_org_id), true)
  )
  on conflict (org_id, id) do update set
    display_name = excluded.display_name,
    identity_kind = excluded.identity_kind,
    credential_hash = excluded.credential_hash,
    payload = excluded.payload,
    removed_at = null;

  return jsonb_build_object(
    'org', (select o.payload from public.orgii_orgs o where o.id = v_org_id),
    'member', (select m.payload from public.orgii_members m where m.org_id = v_org_id and m.id = next_member_id)
  );
end;
$$;

create or replace function public.orgii_create_invite(
  p_org_id text,
  invite_code_hash text,
  usage_limit integer,
  expires_at timestamptz,
  invite_role text,
  payload jsonb,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  next_invite_id text := coalesce(payload->>'id', gen_random_uuid()::text);
begin
  select * into v_ctx
  from public.orgii_authenticate_admin(p_org_id, p_member_id, p_member_token, p_org_secret);

  if coalesce(invite_role, 'member') not in ('member', 'admin') then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  -- payload carries display metadata only (code suffix, limits, creator);
  -- the plaintext code exists solely on the creating client.
  insert into public.orgii_invites (id, org_id, invite_code_hash, usage_limit, expires_at, role, created_by_member_id, payload)
  values (
    next_invite_id,
    p_org_id,
    invite_code_hash,
    coalesce(usage_limit, 10),
    expires_at,
    coalesce(invite_role, 'member'),
    v_ctx.member_id,
    jsonb_set(payload, '{id}', to_jsonb(next_invite_id), true)
  );

  return (select i.payload from public.orgii_invites i where i.id = next_invite_id);
end;
$$;

create or replace function public.orgii_revoke_invite(
  p_org_id text,
  invite_id text,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.orgii_authenticate_admin(p_org_id, p_member_id, p_member_token, p_org_secret);

  update public.orgii_invites
     set revoked_at = now(),
         revoked_by_member_id = v_ctx.member_id,
         payload = jsonb_set(payload, '{revokedAt}', to_jsonb(now()::text), true)
   where id = invite_id and org_id = p_org_id and revoked_at is null;

  if not found then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;
end;
$$;

create or replace function public.orgii_remove_member(
  p_org_id text,
  target_member_id text,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_target record;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, p_org_secret);

  -- self-leave, or admin/root removing anyone
  if not (v_ctx.is_root or v_ctx.member_role = 'admin' or v_ctx.member_id = target_member_id) then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  select m.* into v_target
  from public.orgii_members m
  where m.org_id = p_org_id and m.id = target_member_id and m.removed_at is null;

  if v_target.id is null then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  if v_target.role = 'admin' and not exists (
    select 1 from public.orgii_members m
    where m.org_id = p_org_id and m.role = 'admin' and m.removed_at is null and m.id <> target_member_id
  ) then
    raise exception 'ORGII_LAST_ADMIN';
  end if;

  update public.orgii_members
     set removed_at = now(),
         payload = jsonb_set(payload, '{removedAt}', to_jsonb(now()::text), true)
   where org_id = p_org_id and id = target_member_id;

  return (select m.payload from public.orgii_members m where m.org_id = p_org_id and m.id = target_member_id);
end;
$$;

create or replace function public.orgii_update_member_role(
  p_org_id text,
  target_member_id text,
  new_role text,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_target record;
begin
  perform public.orgii_authenticate_admin(p_org_id, p_member_id, p_member_token, p_org_secret);

  if new_role not in ('member', 'admin') then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  select m.* into v_target
  from public.orgii_members m
  where m.org_id = p_org_id and m.id = target_member_id and m.removed_at is null;

  if v_target.id is null then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  if v_target.role = 'admin' and new_role = 'member' and not exists (
    select 1 from public.orgii_members m
    where m.org_id = p_org_id and m.role = 'admin' and m.removed_at is null and m.id <> target_member_id
  ) then
    raise exception 'ORGII_LAST_ADMIN';
  end if;

  update public.orgii_members
     set role = new_role,
         payload = jsonb_set(payload, '{role}', to_jsonb(new_role), true)
   where org_id = p_org_id and id = target_member_id;
end;
$$;

-- ============================================================ sessions

create or replace function public.orgii_upsert_session_metadata(
  p_org_id text,
  payload jsonb,
  p_member_id text default null,
  p_member_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_payload jsonb;
  v_access_mode text := payload->>'accessMode';
  -- Sharing columns (design §6.2): pre-M4 clients omit both; visibility
  -- defaults to 'org' (those pushes were org-visible all along).
  v_visibility text := coalesce(payload->>'visibility', 'org');
  v_replay_level text := payload->>'replayLevel';
  v_rows integer;
begin
  -- member credential only: session writes always carry a member identity,
  -- so owner_member_id can be forced to the authenticated caller.
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, null);

  if v_visibility not in ('org', 'restricted')
     or (v_replay_level is not null and v_replay_level not in ('metadata', 'replay')) then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  v_payload := jsonb_set(payload, '{ownerMemberId}', to_jsonb(v_ctx.member_id), true);

  insert into public.orgii_sessions (id, org_id, owner_member_id, source_session_id, access_mode, visibility, replay_level, payload)
  values (v_payload->>'id', p_org_id, v_ctx.member_id, v_payload->>'sourceSessionId', v_access_mode, v_visibility, v_replay_level, v_payload)
  on conflict (id) do update set
    access_mode = excluded.access_mode,
    visibility = excluded.visibility,
    replay_level = excluded.replay_level,
    payload = excluded.payload,
    updated_at = now(),
    deleted_at = null,
    -- Downgrading below full_replay drops the segments summary (and the
    -- segment rows below) so consumers stop importing immediately.
    events_epoch = case when excluded.access_mode = 'full_replay' then orgii_sessions.events_epoch else null end,
    events_frozen_seq = case when excluded.access_mode = 'full_replay' then orgii_sessions.events_frozen_seq else null end,
    events_count = case when excluded.access_mode = 'full_replay' then orgii_sessions.events_count else null end,
    events_tail_hash = case when excluded.access_mode = 'full_replay' then orgii_sessions.events_tail_hash else null end,
    events_updated_at = case when excluded.access_mode = 'full_replay' then orgii_sessions.events_updated_at else null end
  where orgii_sessions.owner_member_id = excluded.owner_member_id
    and orgii_sessions.org_id = excluded.org_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  if v_access_mode is distinct from 'full_replay' then
    delete from public.orgii_session_event_segments g
    where g.org_id = p_org_id
      and g.session_row_id = v_payload->>'id';
  end if;
end;
$$;

create or replace function public.orgii_remove_session_metadata(
  p_org_id text,
  owner_member_id text,
  source_session_id text,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, p_org_secret);

  if not (v_ctx.is_root or v_ctx.member_role = 'admin' or v_ctx.member_id = owner_member_id) then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  -- Tombstone with a stripped payload: no title/repoPath/branch survives for
  -- readers that only ever see the deleted row.
  update public.orgii_sessions s
     set deleted_at = now(),
         updated_at = now(),
         events_epoch = null,
         events_frozen_seq = null,
         events_count = null,
         events_tail_hash = null,
         events_updated_at = null,
         payload = jsonb_build_object(
           'id', s.payload->>'id',
           'orgId', s.org_id,
           'ownerMemberId', s.owner_member_id,
           'sourceSessionId', s.source_session_id,
           'deletedAt', now()::text
         )
   where s.org_id = p_org_id
     and s.owner_member_id = orgii_remove_session_metadata.owner_member_id
     and s.source_session_id = orgii_remove_session_metadata.source_session_id
     and s.deleted_at is null;

  -- The row itself is a tombstone (not deleted), so the FK cascade never
  -- fires: purge the segment payloads explicitly.
  delete from public.orgii_session_event_segments g
  using public.orgii_sessions s
  where s.id = g.session_row_id
    and s.org_id = p_org_id
    and g.org_id = p_org_id
    and s.owner_member_id = orgii_remove_session_metadata.owner_member_id
    and s.source_session_id = orgii_remove_session_metadata.source_session_id
    and s.deleted_at is not null;
end;
$$;

-- ============================================================ event segments (design §7)

-- Owner-only append: extend the frozen prefix and/or replace the tail in one
-- transaction. OCC: (expected_epoch, expected_frozen_seq) must match the
-- summary row exactly — one check covers concurrent devices, lost cursors
-- and out-of-order flushes; rejected writers re-anchor via a rewrite.
-- Idempotency: a retried frozen segment whose (epoch, seq) already exists
-- with the SAME segment_hash is a no-op; a different hash is a conflict.
create or replace function public.orgii_append_session_events(
  p_org_id text,
  session_row_id text,
  expected_epoch integer,
  expected_frozen_seq integer,
  frozen_segments jsonb,
  tail jsonb,
  total_count integer,
  p_member_id text default null,
  p_member_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_session record;
  v_seg jsonb;
  v_seq integer;
  v_existing_hash text;
  v_new_frozen_seq integer;
  v_has_tail boolean := tail is not null and jsonb_typeof(tail) = 'object';
begin
  -- Member credential only: segment writes always carry an owner identity.
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, null);

  select s.* into v_session
  from public.orgii_sessions s
  where s.id = orgii_append_session_events.session_row_id
    and s.org_id = p_org_id;

  if v_session.id is null
     or v_session.owner_member_id is distinct from v_ctx.member_id
     or v_session.deleted_at is not null then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  if expected_epoch < 1
     or coalesce(v_session.events_epoch, 0) <> expected_epoch
     or coalesce(v_session.events_frozen_seq, 0) <> expected_frozen_seq then
    raise exception 'ORGII_CONFLICT';
  end if;

  v_new_frozen_seq := expected_frozen_seq;
  for v_seg in select * from jsonb_array_elements(coalesce(frozen_segments, '[]'::jsonb)) loop
    v_seq := (v_seg->>'seq')::integer;
    if v_seq is null or v_seq <= expected_frozen_seq then
      raise exception 'ORGII_CONFLICT';
    end if;
    v_new_frozen_seq := greatest(v_new_frozen_seq, v_seq);

    select g.segment_hash into v_existing_hash
    from public.orgii_session_event_segments g
    where g.org_id = p_org_id
      and g.session_row_id = orgii_append_session_events.session_row_id
      and g.epoch = expected_epoch
      and g.seq = v_seq;

    if found then
      if v_existing_hash is distinct from v_seg->>'segmentHash' then
        raise exception 'ORGII_CONFLICT';
      end if;
      -- Identical retry: skip (network-retry safe).
    else
      insert into public.orgii_session_event_segments
        (org_id, session_row_id, epoch, seq, is_tail, payload_gz, event_count, segment_hash)
      values (
        p_org_id,
        orgii_append_session_events.session_row_id,
        expected_epoch,
        v_seq,
        false,
        decode(v_seg->>'payloadGz', 'base64'),
        (v_seg->>'eventCount')::integer,
        v_seg->>'segmentHash'
      );
    end if;
  end loop;

  -- Single mutable tail row: delete + reinsert (seq 1e9 keeps it far above
  -- any realistic frozen seq inside the same PK space).
  delete from public.orgii_session_event_segments g
  where g.org_id = p_org_id
    and g.session_row_id = orgii_append_session_events.session_row_id
    and g.is_tail;

  if v_has_tail then
    insert into public.orgii_session_event_segments
      (org_id, session_row_id, epoch, seq, is_tail, payload_gz, event_count, segment_hash)
    values (
      p_org_id,
      orgii_append_session_events.session_row_id,
      expected_epoch,
      1000000000,
      true,
      decode(tail->>'payloadGz', 'base64'),
      (tail->>'eventCount')::integer,
      tail->>'segmentHash'
    );
  end if;

  update public.orgii_sessions s
     set events_epoch = expected_epoch,
         events_frozen_seq = v_new_frozen_seq,
         events_count = total_count,
         events_tail_hash = case when v_has_tail then tail->>'segmentHash' else null end,
         events_updated_at = now(),
         updated_at = now()
   where s.id = orgii_append_session_events.session_row_id;
end;
$$;

-- Owner-only atomic rewrite (epoch bump): delete the old generation and
-- write the new one in a single transaction so pullers never observe a
-- partially rewritten stream (design §7.3 step 6).
-- TODO(design §7.3): the staged-commit variant for total payloads > 4MB
-- (pending-marked segments + final commit flip) is out of scope for M3.
create or replace function public.orgii_rewrite_session_events(
  p_org_id text,
  session_row_id text,
  new_epoch integer,
  frozen_segments jsonb,
  tail jsonb,
  total_count integer,
  p_member_id text default null,
  p_member_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_session record;
  v_seg jsonb;
  v_seq integer;
  v_new_frozen_seq integer := 0;
  v_has_tail boolean := tail is not null and jsonb_typeof(tail) = 'object';
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, null);

  select s.* into v_session
  from public.orgii_sessions s
  where s.id = orgii_rewrite_session_events.session_row_id
    and s.org_id = p_org_id;

  if v_session.id is null
     or v_session.owner_member_id is distinct from v_ctx.member_id
     or v_session.deleted_at is not null then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  -- Epochs only move forward; a stale or duplicate rewrite must re-anchor.
  if new_epoch is null or new_epoch <= coalesce(v_session.events_epoch, 0) then
    raise exception 'ORGII_CONFLICT';
  end if;

  delete from public.orgii_session_event_segments g
  where g.org_id = p_org_id
    and g.session_row_id = orgii_rewrite_session_events.session_row_id;

  for v_seg in select * from jsonb_array_elements(coalesce(frozen_segments, '[]'::jsonb)) loop
    v_seq := (v_seg->>'seq')::integer;
    if v_seq is null or v_seq < 1 then
      raise exception 'ORGII_CONFLICT';
    end if;
    v_new_frozen_seq := greatest(v_new_frozen_seq, v_seq);
    insert into public.orgii_session_event_segments
      (org_id, session_row_id, epoch, seq, is_tail, payload_gz, event_count, segment_hash)
    values (
      p_org_id,
      orgii_rewrite_session_events.session_row_id,
      new_epoch,
      v_seq,
      false,
      decode(v_seg->>'payloadGz', 'base64'),
      (v_seg->>'eventCount')::integer,
      v_seg->>'segmentHash'
    );
  end loop;

  if v_has_tail then
    insert into public.orgii_session_event_segments
      (org_id, session_row_id, epoch, seq, is_tail, payload_gz, event_count, segment_hash)
    values (
      p_org_id,
      orgii_rewrite_session_events.session_row_id,
      new_epoch,
      1000000000,
      true,
      decode(tail->>'payloadGz', 'base64'),
      (tail->>'eventCount')::integer,
      tail->>'segmentHash'
    );
  end if;

  update public.orgii_sessions s
     set events_epoch = new_epoch,
         events_frozen_seq = v_new_frozen_seq,
         events_count = total_count,
         events_tail_hash = case when v_has_tail then tail->>'segmentHash' else null end,
         events_updated_at = now(),
         updated_at = now()
   where s.id = orgii_rewrite_session_events.session_row_id;
end;
$$;

-- Read auth (design §6.5): root and owners always; visibility null/'org'
-- rows for any authenticated member; restricted rows only through an
-- active, unexpired replay-level directed grant. Alternatively a share
-- token (link share) reads WITHOUT member credentials — but only the one
-- session the token is bound to, at level 'replay'. Every failure mode
-- (bad token, wrong session, revoked, expired, restricted, tombstoned,
-- missing) raises the same opaque error (§5.5 — no existence oracle).
-- The whole result is built by ONE SELECT, so summary + segments are a
-- consistent statement-level snapshot — a concurrent rewrite can never
-- tear the response.
create or replace function public.orgii_get_session_event_segments(
  p_org_id text,
  session_row_id text,
  after_seq integer default 0,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null,
  p_share_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_authorized boolean := false;
  v_result jsonb;
begin
  if p_share_token is not null then
    v_authorized := exists (
      select 1 from public.orgii_session_shares sh
      where sh.share_token_hash = encode(digest(p_share_token, 'sha256'), 'hex')
        and sh.org_id = p_org_id
        and sh.session_row_id = orgii_get_session_event_segments.session_row_id
        and sh.level = 'replay'
        and sh.revoked_at is null
        and (sh.expires_at is null or sh.expires_at > now())
    );
  else
    select * into v_ctx
    from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, p_org_secret);
    v_authorized := exists (
      select 1 from public.orgii_sessions s
      where s.id = orgii_get_session_event_segments.session_row_id
        and s.org_id = p_org_id
        and (
          v_ctx.is_root
          or s.owner_member_id = v_ctx.member_id
          or coalesce(s.visibility, 'org') = 'org'
          or exists (
            select 1 from public.orgii_session_shares sh
            where sh.org_id = p_org_id
              and sh.session_row_id = s.id
              and sh.grantee_member_id = v_ctx.member_id
              and sh.level = 'replay'
              and sh.revoked_at is null
              and (sh.expires_at is null or sh.expires_at > now())
          )
        )
    );
  end if;

  if not v_authorized then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  select jsonb_build_object(
    'epoch', s.events_epoch,
    'frozenSeq', s.events_frozen_seq,
    'tailHash', s.events_tail_hash,
    'count', s.events_count,
    'segments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'seq', g.seq,
        'isTail', g.is_tail,
        -- encode(..., 'base64') wraps lines per RFC 2045; strip the LFs.
        'payloadGz', replace(encode(g.payload_gz, 'base64'), chr(10), ''),
        'eventCount', g.event_count,
        'segmentHash', g.segment_hash
      ) order by g.seq)
      from public.orgii_session_event_segments g
      where g.org_id = s.org_id
        and g.session_row_id = s.id
        and g.epoch = s.events_epoch
        and (g.is_tail or g.seq > coalesce(after_seq, 0))
    ), '[]'::jsonb)
  ) into v_result
  from public.orgii_sessions s
  where s.id = orgii_get_session_event_segments.session_row_id
    and s.org_id = p_org_id
    and s.deleted_at is null;

  if v_result is null then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;
  return v_result;
end;
$$;

-- Retention sweep (design §7.5, default 90 days): admin clients trigger this
-- periodically; segments of sessions with no recent events activity are
-- dropped and their summaries cleared (consumers keep local copies).
create or replace function public.orgii_gc_session_event_segments(
  p_org_id text,
  retention_days integer default 90,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(retention_days, 90), 1));
  v_deleted integer;
begin
  perform public.orgii_authenticate_admin(p_org_id, p_member_id, p_member_token, p_org_secret);

  delete from public.orgii_session_event_segments g
  using public.orgii_sessions s
  where s.id = g.session_row_id
    and g.org_id = p_org_id
    and s.org_id = p_org_id
    and coalesce(s.events_updated_at, s.updated_at) < v_cutoff;

  get diagnostics v_deleted = row_count;

  update public.orgii_sessions s
     set events_epoch = null,
         events_frozen_seq = null,
         events_count = null,
         events_tail_hash = null
   where s.org_id = p_org_id
     and s.events_epoch is not null
     and coalesce(s.events_updated_at, s.updated_at) < v_cutoff;

  return v_deleted;
end;
$$;

-- ============================================================ session shares (design §6)

-- Owner-only: create a directed share (grantee_member_id) or a link share
-- (share_token_hash — sha256 of a token that never reaches the server in
-- plaintext) for one of the caller's own sessions. Exactly one of the two
-- grant shapes must be set. The session row's updated_at is bumped so the
-- new grantee receives the row in the next delta pull (§6.5 review
-- finding). Returns the share id.
create or replace function public.orgii_create_session_share(
  p_org_id text,
  session_row_id text,
  grantee_member_id text,
  share_token_hash text,
  level text,
  expires_at timestamptz,
  p_member_id text default null,
  p_member_token text default null
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_session record;
  v_share_id text := gen_random_uuid()::text;
begin
  -- Member credential only: a share is always created by its owner.
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, null);

  if orgii_create_session_share.level not in ('metadata', 'replay') then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  -- Exactly one grant shape: directed (grantee) XOR link (token hash).
  if (orgii_create_session_share.grantee_member_id is null)
     = (orgii_create_session_share.share_token_hash is null) then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  select s.* into v_session
  from public.orgii_sessions s
  where s.id = orgii_create_session_share.session_row_id
    and s.org_id = p_org_id;

  if v_session.id is null
     or v_session.owner_member_id is distinct from v_ctx.member_id
     or v_session.deleted_at is not null then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  -- Directed shares must target a live member (a typo would otherwise
  -- create a silent dead grant; the roster is member-visible, no oracle).
  if orgii_create_session_share.grantee_member_id is not null and not exists (
    select 1 from public.orgii_members m
    where m.org_id = p_org_id
      and m.id = orgii_create_session_share.grantee_member_id
      and m.removed_at is null
  ) then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  insert into public.orgii_session_shares
    (id, org_id, session_row_id, owner_member_id, grantee_member_id, share_token_hash, level, expires_at)
  values (
    v_share_id,
    p_org_id,
    orgii_create_session_share.session_row_id,
    v_ctx.member_id,
    orgii_create_session_share.grantee_member_id,
    orgii_create_session_share.share_token_hash,
    orgii_create_session_share.level,
    orgii_create_session_share.expires_at
  );

  update public.orgii_sessions s
     set updated_at = now()
   where s.id = orgii_create_session_share.session_row_id;

  return v_share_id;
end;
$$;

-- Owner (or admin/root): revoke a share. Idempotent on the share row; the
-- session row is bumped either way so consumers whose visibility just
-- vanished get the row in their next delta and drop it through the SQL
-- visibility filter (§6.5).
create or replace function public.orgii_revoke_session_share(
  p_org_id text,
  share_id text,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_share record;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, p_org_secret);

  select sh.* into v_share
  from public.orgii_session_shares sh
  where sh.id = orgii_revoke_session_share.share_id
    and sh.org_id = p_org_id;

  if v_share.id is null
     or not (v_ctx.is_root
             or v_ctx.member_role = 'admin'
             or v_share.owner_member_id = v_ctx.member_id) then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  update public.orgii_session_shares sh
     set revoked_at = now()
   where sh.id = orgii_revoke_session_share.share_id
     and sh.revoked_at is null;

  update public.orgii_sessions s
     set updated_at = now()
   where s.id = v_share.session_row_id;
end;
$$;

-- Owner-only management listing: active + revoked shares for one of the
-- caller's sessions. Token hashes NEVER leave the server — hasToken marks
-- link shares.
create or replace function public.orgii_list_session_shares(
  p_org_id text,
  session_row_id text,
  p_member_id text default null,
  p_member_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_session record;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, null);

  select s.* into v_session
  from public.orgii_sessions s
  where s.id = orgii_list_session_shares.session_row_id
    and s.org_id = p_org_id;

  if v_session.id is null
     or v_session.owner_member_id is distinct from v_ctx.member_id then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', sh.id,
      'granteeMemberId', sh.grantee_member_id,
      'level', sh.level,
      'expiresAt', sh.expires_at,
      'createdAt', sh.created_at,
      'revokedAt', sh.revoked_at,
      'hasToken', sh.share_token_hash is not null
    ) order by sh.created_at desc)
    from public.orgii_session_shares sh
    where sh.org_id = p_org_id
      and sh.session_row_id = orgii_list_session_shares.session_row_id
  ), '[]'::jsonb);
end;
$$;

-- TICKET tier (anon + share token only, design §6.4): resolve a link share
-- to the bound session's metadata projection (payload plus the segments
-- summary fields, same shape as a list_org_state sessions row). Missing,
-- revoked, expired, wrong-level and tombstoned all raise the same opaque
-- error (§5.5 — no existence oracle). Only replay-level link shares
-- resolve; the guest then pulls segments with the same token.
create or replace function public.orgii_resolve_session_share(
  share_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_result jsonb;
begin
  select s.payload || jsonb_build_object(
    'eventsEpoch', s.events_epoch,
    'eventsFrozenSeq', s.events_frozen_seq,
    'eventsCount', s.events_count,
    'eventsTailHash', s.events_tail_hash
  ) into v_result
  from public.orgii_session_shares sh
  join public.orgii_sessions s
    on s.id = sh.session_row_id and s.org_id = sh.org_id
  where sh.share_token_hash = encode(digest(share_token, 'sha256'), 'hex')
    and sh.revoked_at is null
    and (sh.expires_at is null or sh.expires_at > now())
    and sh.level = 'replay'
    and s.deleted_at is null;

  if v_result is null then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;
  return v_result;
end;
$$;

-- ============================================================ chat

create or replace function public.orgii_post_chat_message(
  p_org_id text,
  payload jsonb,
  p_member_id text default null,
  p_member_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_payload jsonb;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, null);

  v_payload := jsonb_set(payload, '{authorMemberId}', to_jsonb(v_ctx.member_id), true);

  insert into public.orgii_chat_messages (id, org_id, author_member_id, payload)
  values (v_payload->>'id', p_org_id, v_ctx.member_id, v_payload)
  on conflict (id) do update set payload = excluded.payload
  where orgii_chat_messages.author_member_id = excluded.author_member_id;

  return v_payload;
end;
$$;

-- ============================================================ projects / work items (typed, OCC)

create or replace function public.orgii_upsert_project(
  p_org_id text,
  project jsonb,
  base_version integer,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_id text := coalesce(project->>'id', gen_random_uuid()::text);
  v_existing record;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, p_org_secret);

  select p.* into v_existing from public.orgii_projects p where p.id = v_id;

  if v_existing.id is not null then
    if v_existing.org_id <> p_org_id or v_existing.version <> coalesce(base_version, -1) then
      raise exception 'ORGII_CONFLICT';
    end if;
    update public.orgii_projects
       set payload = project,
           slug = project->>'slug',
           name = project->>'name',
           status = project->>'status',
           priority = project->>'priority',
           health = project->>'health',
           lead_member_id = project->>'leadMemberId',
           description = project->>'description',
           start_date = project->>'startDate',
           target_date = project->>'targetDate',
           work_item_prefix = project->>'workItemPrefix',
           version = v_existing.version + 1,
           updated_by_member_id = v_ctx.member_id,
           deleted_at = null,
           updated_at = now()
     where id = v_id;
  else
    insert into public.orgii_projects (
      id, org_id, payload, slug, name, status, priority, health, lead_member_id,
      description, start_date, target_date, work_item_prefix, version, updated_by_member_id
    ) values (
      v_id, p_org_id, project, project->>'slug', project->>'name', project->>'status',
      project->>'priority', project->>'health', project->>'leadMemberId', project->>'description',
      project->>'startDate', project->>'targetDate', project->>'workItemPrefix', 1, v_ctx.member_id
    );
  end if;

  return jsonb_build_object('id', v_id, 'version', (select p.version from public.orgii_projects p where p.id = v_id));
end;
$$;

create or replace function public.orgii_delete_project(
  p_org_id text,
  project_id text,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.orgii_authenticate_admin(p_org_id, p_member_id, p_member_token, p_org_secret);

  update public.orgii_projects
     set deleted_at = now(),
         updated_at = now(),
         version = version + 1
   where id = project_id and org_id = p_org_id and deleted_at is null;

  update public.orgii_work_items
     set deleted_at = now(),
         updated_at = now(),
         version = version + 1
   where orgii_work_items.project_id = orgii_delete_project.project_id
     and org_id = p_org_id and deleted_at is null;
end;
$$;

create or replace function public.orgii_upsert_work_item(
  p_org_id text,
  work_item jsonb,
  base_version integer,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_id text := coalesce(work_item->>'id', gen_random_uuid()::text);
  v_existing record;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, p_org_secret);

  select w.* into v_existing from public.orgii_work_items w where w.id = v_id;

  if v_existing.id is not null then
    if v_existing.org_id <> p_org_id or v_existing.version <> coalesce(base_version, -1) then
      raise exception 'ORGII_CONFLICT';
    end if;
    update public.orgii_work_items
       set payload = work_item,
           project_id = work_item->>'projectId',
           short_id = work_item->>'shortId',
           title = work_item->>'title',
           body = work_item->>'body',
           status = work_item->>'status',
           priority = work_item->>'priority',
           assignee_member_id = work_item->>'assigneeMemberId',
           assignee_type = work_item->>'assigneeType',
           milestone = work_item->>'milestone',
           parent_id = work_item->>'parentId',
           start_date = work_item->>'startDate',
           target_date = work_item->>'targetDate',
           version = v_existing.version + 1,
           updated_by_member_id = v_ctx.member_id,
           deleted_at = null,
           updated_at = now()
     where id = v_id;
  else
    insert into public.orgii_work_items (
      id, org_id, payload, project_id, short_id, title, body, status, priority,
      assignee_member_id, assignee_type, milestone, parent_id, start_date, target_date,
      version, updated_by_member_id
    ) values (
      v_id, p_org_id, work_item, work_item->>'projectId', work_item->>'shortId',
      work_item->>'title', work_item->>'body', work_item->>'status', work_item->>'priority',
      work_item->>'assigneeMemberId', work_item->>'assigneeType', work_item->>'milestone',
      work_item->>'parentId', work_item->>'startDate', work_item->>'targetDate', 1, v_ctx.member_id
    );
  end if;

  return jsonb_build_object('id', v_id, 'version', (select w.version from public.orgii_work_items w where w.id = v_id));
end;
$$;

create or replace function public.orgii_delete_work_item(
  p_org_id text,
  work_item_id text,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.orgii_authenticate(p_org_id, p_member_id, p_member_token, p_org_secret);

  update public.orgii_work_items
     set deleted_at = now(),
         updated_at = now(),
         version = version + 1
   where id = work_item_id and org_id = p_org_id and deleted_at is null;
end;
$$;

-- Short-id allocator (design §16.5): the per-project counter lives on the
-- server so two members can never mint the same PREFIX-n. Atomic
-- update-returning; the counter is server-owned — orgii_upsert_project never
-- writes next_work_item_id, and allocation does NOT bump version/updated_at
-- (nothing row-visible changes for other members). Missing/tombstoned
-- project raises the uniform ORGII_CONFLICT so callers fall back to a local
-- provisional id without learning why.
create or replace function public.orgii_allocate_work_item_short_id(
  p_org_id text,
  project_id text,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_n integer;
  v_prefix text;
begin
  perform public.orgii_authenticate(p_org_id, p_member_id, p_member_token, p_org_secret);

  update public.orgii_projects
     set next_work_item_id = next_work_item_id + 1
   where id = project_id and org_id = p_org_id and deleted_at is null
  returning next_work_item_id - 1, coalesce(work_item_prefix, 'WI')
    into v_n, v_prefix;

  if v_n is null then
    raise exception 'ORGII_CONFLICT';
  end if;

  return jsonb_build_object('shortId', v_prefix || '-' || lpad(v_n::text, 4, '0'), 'n', v_n);
end;
$$;

-- Execution lock arbitration (design §16.6): the lock is stored inside the
-- work item payload jsonb so it propagates to every member through the
-- normal delta. Acquire is OCC — it succeeds only while no lock is present;
-- a held lock raises the uniform ORGII_CONFLICT (holder identity travels in
-- the synced row, never in the error). lockedByMemberId is forced to the
-- authenticated member so a client cannot acquire on someone else's behalf.
create or replace function public.orgii_acquire_work_item_lock(
  p_org_id text,
  work_item_id text,
  lock_payload jsonb,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_lock jsonb;
  v_version integer;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, p_org_secret);

  v_lock := coalesce(lock_payload, '{}'::jsonb);
  if v_ctx.member_id is not null then
    v_lock := jsonb_set(v_lock, '{lockedByMemberId}', to_jsonb(v_ctx.member_id), true);
  end if;

  update public.orgii_work_items
     set payload = jsonb_set(payload, '{executionLock}', v_lock, true),
         version = version + 1,
         updated_by_member_id = v_ctx.member_id,
         updated_at = now()
   where id = work_item_id and org_id = p_org_id and deleted_at is null
     and (payload->'executionLock' is null or payload->'executionLock' = 'null'::jsonb)
  returning version into v_version;

  if v_version is null then
    raise exception 'ORGII_CONFLICT';
  end if;

  return v_version;
end;
$$;

-- Release: only the lock holder or an admin/root may clear. Releasing an
-- already-unlocked row is idempotent (returns the current version).
create or replace function public.orgii_release_work_item_lock(
  p_org_id text,
  work_item_id text,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_row record;
  v_version integer;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, p_org_secret);

  select w.version, w.payload->'executionLock' as lock into v_row
  from public.orgii_work_items w
  where w.id = work_item_id and w.org_id = p_org_id and w.deleted_at is null;

  if v_row.version is null then
    raise exception 'ORGII_CONFLICT';
  end if;

  if v_row.lock is null or v_row.lock = 'null'::jsonb then
    return v_row.version;
  end if;

  if not (
    v_ctx.is_root
    or v_ctx.member_role = 'admin'
    or v_row.lock->>'lockedByMemberId' = v_ctx.member_id
  ) then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  update public.orgii_work_items
     set payload = payload - 'executionLock',
         version = version + 1,
         updated_by_member_id = v_ctx.member_id,
         updated_at = now()
   where id = work_item_id and org_id = p_org_id
  returning version into v_version;

  return v_version;
end;
$$;

-- ============================================================ legacy snapshot flow (retired with segments)

create or replace function public.orgii_request_session_snapshot(
  p_org_id text,
  payload jsonb,
  p_member_id text default null,
  p_member_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_payload jsonb;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, null);

  v_payload := jsonb_set(payload, '{requesterMemberId}', to_jsonb(v_ctx.member_id), true);

  insert into public.orgii_session_snapshot_requests (
    request_id, org_id, requester_member_id, owner_member_id, source_session_id, status, payload
  ) values (
    v_payload->>'requestId', p_org_id, v_ctx.member_id, v_payload->>'ownerMemberId', v_payload->>'sourceSessionId', v_payload->>'status', v_payload
  ) on conflict (request_id) do update set
    status = excluded.status,
    payload = excluded.payload,
    updated_at = now()
  where orgii_session_snapshot_requests.requester_member_id = excluded.requester_member_id;
end;
$$;

create or replace function public.orgii_create_session_snapshot(
  p_org_id text,
  request_id text,
  source_session_id text,
  metadata jsonb,
  payload_gz text,
  p_member_id text default null,
  p_member_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, null);

  if not exists (
    select 1 from public.orgii_session_snapshot_requests r
    where r.request_id = orgii_create_session_snapshot.request_id
      and r.org_id = p_org_id
      and r.owner_member_id = v_ctx.member_id
  ) then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  -- payload_gz: base64 of the client-gzipped {session, events} JSON — the
  -- Storage-free replacement for the retired snapshot bucket blob.
  insert into public.orgii_session_snapshots (request_id, org_id, source_session_id, payload_gz, metadata)
  values (request_id, p_org_id, source_session_id, decode(payload_gz, 'base64'), metadata)
  on conflict (request_id) do update set
    payload_gz = excluded.payload_gz,
    metadata = excluded.metadata;

  update public.orgii_session_snapshot_requests
     set status = 'completed', updated_at = now(),
         payload = jsonb_set(payload, '{status}', to_jsonb('completed'::text), true)
   where orgii_session_snapshot_requests.request_id = orgii_create_session_snapshot.request_id;
end;
$$;

create or replace function public.orgii_deny_session_snapshot(
  p_org_id text,
  request_id text,
  reason text,
  p_member_id text default null,
  p_member_token text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, null);

  update public.orgii_session_snapshot_requests
     set status = 'denied', error = reason, updated_at = now(),
         payload = jsonb_set(jsonb_set(payload, '{status}', to_jsonb('denied'::text), true), '{error}', to_jsonb(reason), true)
   where orgii_session_snapshot_requests.request_id = orgii_deny_session_snapshot.request_id
     and orgii_session_snapshot_requests.org_id = p_org_id
     and orgii_session_snapshot_requests.owner_member_id = v_ctx.member_id;

  if not found then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;
end;
$$;

-- ============================================================ repo scopes

create or replace function public.orgii_update_org_repo_scopes(
  p_org_id text,
  repo_scopes text[],
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.orgii_authenticate_admin(p_org_id, p_member_id, p_member_token, p_org_secret);

  update public.orgii_orgs
     set payload = jsonb_set(payload, '{repoScopes}', to_jsonb(repo_scopes), true)
   where id = p_org_id;
end;
$$;

create or replace function public.orgii_request_repo_join(
  p_org_id text,
  repo_path text,
  payload jsonb,
  p_member_id text default null,
  p_member_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  next_request_id text := coalesce(payload->>'requestId', gen_random_uuid()::text);
  existing_request record;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, null);

  select r.* into existing_request
  from public.orgii_repo_join_requests r
  where r.org_id = p_org_id
    and r.requester_member_id = v_ctx.member_id
    and r.repo_path = orgii_request_repo_join.repo_path
    and r.status = 'pending'
  limit 1;

  if existing_request.request_id is not null then
    return (select r.payload from public.orgii_repo_join_requests r where r.request_id = existing_request.request_id);
  end if;

  insert into public.orgii_repo_join_requests (request_id, org_id, requester_member_id, repo_path, status, payload)
  values (
    next_request_id, p_org_id, v_ctx.member_id, repo_path, 'pending',
    jsonb_set(jsonb_set(payload, '{requestId}', to_jsonb(next_request_id), true), '{requesterMemberId}', to_jsonb(v_ctx.member_id), true)
  );

  return (select r.payload from public.orgii_repo_join_requests r where r.request_id = next_request_id);
end;
$$;

create or replace function public.orgii_review_repo_join(
  p_org_id text,
  request_id text,
  approve boolean,
  review_note text,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  target_request record;
  new_status text;
begin
  select * into v_ctx
  from public.orgii_authenticate_admin(p_org_id, p_member_id, p_member_token, p_org_secret);

  select r.* into target_request
  from public.orgii_repo_join_requests r
  where r.request_id = orgii_review_repo_join.request_id and r.org_id = p_org_id;

  if target_request.request_id is null then
    raise exception 'ORGII_UNAUTHORIZED';
  end if;

  new_status := case when approve then 'approved' else 'rejected' end;

  update public.orgii_repo_join_requests
     set status = new_status,
         reviewer_member_id = v_ctx.member_id,
         review_note = orgii_review_repo_join.review_note,
         reviewed_at = now(),
         payload = jsonb_set(jsonb_set(jsonb_set(
           payload,
           '{status}', to_jsonb(new_status), true),
           '{reviewerMemberId}', coalesce(to_jsonb(v_ctx.member_id), 'null'::jsonb), true),
           '{reviewedAt}', to_jsonb(now()::text), true)
   where orgii_repo_join_requests.request_id = orgii_review_repo_join.request_id;

  if approve then
    update public.orgii_orgs
       set payload = jsonb_set(
         payload,
         '{repoScopes}',
         coalesce(
           (select jsonb_agg(elem) from (
             select jsonb_array_elements_text(coalesce(payload->'repoScopes', '[]'::jsonb)) as elem
             union select target_request.repo_path
           ) s),
           to_jsonb(ARRAY[target_request.repo_path])
         ),
         true
       )
     where id = target_request.org_id;
  end if;

  return (select r.payload from public.orgii_repo_join_requests r where r.request_id = orgii_review_repo_join.request_id);
end;
$$;

-- ============================================================ list org state

create or replace function public.orgii_list_org_state(
  p_org_id text,
  since_timestamp timestamptz default null,
  p_member_id text default null,
  p_member_token text default null,
  p_org_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ctx record;
  v_since timestamptz := coalesce(since_timestamp, '1970-01-01'::timestamptz);
  v_is_admin boolean;
begin
  select * into v_ctx
  from public.orgii_authenticate(p_org_id, p_member_id, p_member_token, p_org_secret);
  v_is_admin := v_ctx.is_root or v_ctx.member_role = 'admin';

  return jsonb_build_object(
    'serverTime', now(),
    'orgs', coalesce((select jsonb_agg(o.payload - 'orgSecret' - 'supabaseAnonKey' - 'memberToken') from public.orgii_orgs o where o.id = p_org_id), '[]'::jsonb),
    -- members always returned in full, including removed ones (tombstone
    -- propagation): the roster is small and clients filter on removedAt.
    'members', coalesce((select jsonb_agg(m.payload) from public.orgii_members m where m.org_id = p_org_id), '[]'::jsonb),
    -- invites are admin-only (display metadata; plaintext codes never stored)
    'invites', case when v_is_admin
      then coalesce((select jsonb_agg(i.payload) from public.orgii_invites i where i.org_id = p_org_id and i.revoked_at is null), '[]'::jsonb)
      else '[]'::jsonb end,
    'projects', coalesce((
      select jsonb_agg(
        p.payload || jsonb_build_object(
          'version', p.version,
          'updatedByMemberId', p.updated_by_member_id,
          'deletedAt', p.deleted_at
        )
      )
      from public.orgii_projects p
      where p.org_id = p_org_id and p.updated_at >= v_since
    ), '[]'::jsonb),
    'workItems', coalesce((
      select jsonb_agg(
        w.payload || jsonb_build_object(
          'version', w.version,
          'updatedByMemberId', w.updated_by_member_id,
          'deletedAt', w.deleted_at
        )
      )
      from public.orgii_work_items w
      where w.org_id = p_org_id and w.updated_at >= v_since
    ), '[]'::jsonb),
    -- Visibility filter (design §6.5 — a security boundary, so it lives in
    -- SQL; repoScopes filtering stays client-side as a participation
    -- preference): root and owners see everything; visibility null/'org'
    -- rows reach the whole org; restricted rows need an active, unexpired
    -- grant. Tombstones pass under the SAME conditions — an org-visible
    -- tombstone propagates org-wide, a restricted one reaches only owner +
    -- grantees (§6.6: no visibility widening through death).
    'sessions', coalesce((
      select jsonb_agg(
        s.payload || jsonb_build_object(
          'eventsEpoch', s.events_epoch,
          'eventsFrozenSeq', s.events_frozen_seq,
          'eventsCount', s.events_count,
          'eventsTailHash', s.events_tail_hash,
          'deletedAt', s.deleted_at
        )
      )
      from public.orgii_sessions s
      where s.org_id = p_org_id and s.updated_at >= v_since
        and (
          v_ctx.is_root
          or s.owner_member_id = v_ctx.member_id
          or coalesce(s.visibility, 'org') = 'org'
          or exists (
            select 1 from public.orgii_session_shares sh
            where sh.org_id = p_org_id
              and sh.session_row_id = s.id
              and sh.grantee_member_id = v_ctx.member_id
              and sh.revoked_at is null
              and (sh.expires_at is null or sh.expires_at > now())
          )
        )
    ), '[]'::jsonb),
    'chatMessages', coalesce((select jsonb_agg(c.payload) from public.orgii_chat_messages c where c.org_id = p_org_id and c.created_at >= v_since), '[]'::jsonb),
    'snapshotRequests', coalesce((
      select jsonb_agg(
        r.payload || jsonb_build_object(
          'error', r.error,
          -- Inline gzipped payload (base64): rows fall out of the delta
          -- window right after completion, so the cost matches the old
          -- blob download without touching Storage.
          'payloadGz', case when sn.payload_gz is null then null
            else replace(encode(sn.payload_gz, 'base64'), chr(10), '') end,
          'session', sn.metadata
        )
      )
      from public.orgii_session_snapshot_requests r
      left join public.orgii_session_snapshots sn using (request_id)
      where r.org_id = p_org_id and r.updated_at >= v_since
    ), '[]'::jsonb),
    'repoJoinRequests', coalesce((
      select jsonb_agg(
        j.payload || jsonb_build_object(
          'status', j.status,
          'reviewerMemberId', j.reviewer_member_id,
          'reviewNote', j.review_note,
          'reviewedAt', j.reviewed_at
        )
      )
      from public.orgii_repo_join_requests j
      where j.org_id = p_org_id and j.created_at >= v_since
    ), '[]'::jsonb)
  );
end;
$$;

-- ============================================================ grants
-- Every function stays granted to anon (PostgREST requirement); authorization
-- happens inside. Tiers: public (sync_version, create_org), ticket
-- (accept_invite, resolve_session_share, share-token segment reads),
-- credential (everything else).

grant execute on function public.orgii_sync_version() to anon;
grant execute on function public.orgii_authenticate(text, text, text, text) to anon;
grant execute on function public.orgii_authenticate_admin(text, text, text, text) to anon;
grant execute on function public.orgii_create_org(text, text, text, text, text, jsonb, jsonb) to anon;
grant execute on function public.orgii_accept_invite(text, text, text, text, jsonb) to anon;
grant execute on function public.orgii_create_invite(text, text, integer, timestamptz, text, jsonb, text, text, text) to anon;
grant execute on function public.orgii_revoke_invite(text, text, text, text, text) to anon;
grant execute on function public.orgii_remove_member(text, text, text, text, text) to anon;
grant execute on function public.orgii_update_member_role(text, text, text, text, text, text) to anon;
grant execute on function public.orgii_upsert_session_metadata(text, jsonb, text, text) to anon;
grant execute on function public.orgii_remove_session_metadata(text, text, text, text, text, text) to anon;
grant execute on function public.orgii_append_session_events(text, text, integer, integer, jsonb, jsonb, integer, text, text) to anon;
grant execute on function public.orgii_rewrite_session_events(text, text, integer, jsonb, jsonb, integer, text, text) to anon;
grant execute on function public.orgii_get_session_event_segments(text, text, integer, text, text, text, text) to anon;
grant execute on function public.orgii_gc_session_event_segments(text, integer, text, text, text) to anon;
grant execute on function public.orgii_create_session_share(text, text, text, text, text, timestamptz, text, text) to anon;
grant execute on function public.orgii_revoke_session_share(text, text, text, text, text) to anon;
grant execute on function public.orgii_list_session_shares(text, text, text, text) to anon;
grant execute on function public.orgii_resolve_session_share(text) to anon;
grant execute on function public.orgii_post_chat_message(text, jsonb, text, text) to anon;
grant execute on function public.orgii_upsert_project(text, jsonb, integer, text, text, text) to anon;
grant execute on function public.orgii_delete_project(text, text, text, text, text) to anon;
grant execute on function public.orgii_upsert_work_item(text, jsonb, integer, text, text, text) to anon;
grant execute on function public.orgii_delete_work_item(text, text, text, text, text) to anon;
grant execute on function public.orgii_allocate_work_item_short_id(text, text, text, text, text) to anon;
grant execute on function public.orgii_acquire_work_item_lock(text, text, jsonb, text, text, text) to anon;
grant execute on function public.orgii_release_work_item_lock(text, text, text, text, text) to anon;
grant execute on function public.orgii_request_session_snapshot(text, jsonb, text, text) to anon;
grant execute on function public.orgii_create_session_snapshot(text, text, text, jsonb, text, text, text) to anon;
grant execute on function public.orgii_deny_session_snapshot(text, text, text, text, text) to anon;
grant execute on function public.orgii_update_org_repo_scopes(text, text[], text, text, text) to anon;
grant execute on function public.orgii_request_repo_join(text, text, jsonb, text, text) to anon;
grant execute on function public.orgii_review_repo_join(text, text, boolean, text, text, text, text) to anon;
grant execute on function public.orgii_list_org_state(text, timestamptz, text, text, text) to anon;

insert into public.orgii_sync_meta (schema_version)
values (${SUPABASE_SYNC_SCHEMA_VERSION})
on conflict (schema_version) do nothing;`;
