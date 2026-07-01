import {
  SUPABASE_SESSION_SNAPSHOT_BUCKET,
  SUPABASE_SYNC_SCHEMA_VERSION,
} from "@src/store/collaboration/types";

export const ORGII_SUPABASE_SETUP_SQL = `create extension if not exists pgcrypto;

create table if not exists public.orgii_sync_meta (
  schema_version integer primary key,
  created_at timestamptz not null default now()
);

insert into public.orgii_sync_meta (schema_version)
values (${SUPABASE_SYNC_SCHEMA_VERSION})
on conflict (schema_version) do nothing;

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

create table if not exists public.orgii_projects (
  id text primary key,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.orgii_work_items (
  id text primary key,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.orgii_sessions (
  id text primary key,
  org_id text not null references public.orgii_orgs(id) on delete cascade,
  owner_member_id text not null,
  source_session_id text not null,
  access_mode text,
  payload jsonb not null,
  events_blob_path text,
  events_content_hash text,
  events_updated_at timestamptz,
  updated_at timestamptz not null default now()
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
  blob_path text not null,
  content_hash text not null,
  metadata jsonb not null,
  created_at timestamptz not null default now()
);

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
alter table public.orgii_chat_messages enable row level security;
alter table public.orgii_session_snapshot_requests enable row level security;
alter table public.orgii_session_snapshots enable row level security;
alter table public.orgii_repo_join_requests enable row level security;

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

create policy orgii_snapshots_anon_read
on storage.objects for select to anon
using (bucket_id = '${SUPABASE_SESSION_SNAPSHOT_BUCKET}');

create policy orgii_snapshots_anon_insert
on storage.objects for insert to anon
with check (bucket_id = '${SUPABASE_SESSION_SNAPSHOT_BUCKET}');

create policy orgii_snapshots_anon_update
on storage.objects for update to anon
using (bucket_id = '${SUPABASE_SESSION_SNAPSHOT_BUCKET}')
with check (bucket_id = '${SUPABASE_SESSION_SNAPSHOT_BUCKET}');

create or replace function public.orgii_sync_version()
returns integer
language sql
security definer
set search_path = public
as $$
  select max(schema_version) from public.orgii_sync_meta;
$$;

create or replace function public.orgii_validate_org_secret(p_org_id text, p_org_secret text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orgii_orgs
    where id = p_org_id
      and secret_hash = encode(digest(p_org_secret, 'sha256'), 'hex')
  ) or exists (
    select 1
    from public.orgii_invites
    where org_id = p_org_id
      and invite_code_hash = encode(digest(p_org_secret, 'sha256'), 'hex')
      and revoked_at is null
      and (expires_at is null or expires_at > now())
  );
$$;

create or replace function public.orgii_create_org(
  org_name text,
  display_name text,
  identity_kind text,
  org_secret_hash text,
  payload jsonb,
  member_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_org_id text := coalesce(payload->>'id', gen_random_uuid()::text);
  next_member_id text := coalesce(member_payload->>'id', gen_random_uuid()::text);
begin
  insert into public.orgii_orgs (id, name, secret_hash, payload)
  values (next_org_id, org_name, org_secret_hash, jsonb_set(payload, '{id}', to_jsonb(next_org_id), true));

  insert into public.orgii_members (id, org_id, display_name, identity_kind, role, payload)
  values (
    next_member_id,
    next_org_id,
    display_name,
    identity_kind,
    'admin',
    jsonb_set(jsonb_set(member_payload, '{id}', to_jsonb(next_member_id), true), '{orgId}', to_jsonb(next_org_id), true)
  );

  return jsonb_build_object(
    'org', (select payload from public.orgii_orgs where id = next_org_id),
    'member', (select payload from public.orgii_members where org_id = next_org_id and id = next_member_id)
  );
end;
$$;

create or replace function public.orgii_create_invite(
  org_secret text,
  org_id text,
  invite_code_hash text,
  usage_limit integer,
  expires_at timestamptz,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_invite_id text := coalesce(payload->>'id', gen_random_uuid()::text);
begin
  if not public.orgii_validate_org_secret(org_id, org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  insert into public.orgii_invites (id, org_id, invite_code_hash, usage_limit, expires_at, payload)
  values (next_invite_id, org_id, invite_code_hash, coalesce(usage_limit, 10), expires_at, payload);

  return (select payload from public.orgii_invites where id = next_invite_id);
end;
$$;

create or replace function public.orgii_accept_invite(
  invite_code text,
  display_name text,
  identity_kind text,
  member_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_invite record;
  next_member_id text := coalesce(member_payload->>'id', gen_random_uuid()::text);
begin
  select * into matched_invite
  from public.orgii_invites
  where invite_code_hash = encode(digest(invite_code, 'sha256'), 'hex')
    and revoked_at is null
    and (expires_at is null or expires_at > now())
    and usage_count < usage_limit
  limit 1;

  if matched_invite.id is null then
    raise exception 'Invite is invalid or expired';
  end if;

  insert into public.orgii_members (id, org_id, display_name, identity_kind, role, payload)
  values (
    next_member_id,
    matched_invite.org_id,
    display_name,
    identity_kind,
    'member',
    jsonb_set(jsonb_set(member_payload, '{id}', to_jsonb(next_member_id), true), '{orgId}', to_jsonb(matched_invite.org_id), true)
  )
  on conflict (org_id, id) do update set
    display_name = excluded.display_name,
    identity_kind = excluded.identity_kind,
    payload = excluded.payload,
    removed_at = null;

  update public.orgii_invites
  set usage_count = usage_count + 1,
      payload = jsonb_set(payload, '{usageCount}', to_jsonb(usage_count + 1), true)
  where id = matched_invite.id;

  return jsonb_build_object(
    'org', (select payload from public.orgii_orgs where id = matched_invite.org_id),
    'member', (select payload from public.orgii_members where org_id = matched_invite.org_id and id = next_member_id)
  );
end;
$$;

create or replace function public.orgii_remove_member(org_secret text, org_id text, member_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.orgii_validate_org_secret(org_id, org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  update public.orgii_members
  set removed_at = now(), payload = jsonb_set(payload, '{removedAt}', to_jsonb(now()::text), true)
  where orgii_members.org_id = orgii_remove_member.org_id and id = member_id;

  return (select payload from public.orgii_members where orgii_members.org_id = orgii_remove_member.org_id and id = member_id);
end;
$$;

create or replace function public.orgii_upsert_member(org_secret text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.orgii_validate_org_secret(payload->>'orgId', org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  insert into public.orgii_members (id, org_id, display_name, identity_kind, role, payload)
  values (payload->>'id', payload->>'orgId', payload->>'displayName', payload->>'identityKind', payload->>'role', payload)
  on conflict (org_id, id) do update set
    display_name = excluded.display_name,
    identity_kind = excluded.identity_kind,
    role = excluded.role,
    payload = excluded.payload,
    removed_at = null;
end;
$$;

create or replace function public.orgii_upsert_project(org_secret text, org_id text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.orgii_validate_org_secret(org_id, org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  insert into public.orgii_projects (id, org_id, payload)
  values (coalesce(payload->>'id', gen_random_uuid()::text), org_id, payload)
  on conflict (id) do update set
    payload = excluded.payload,
    updated_at = now();
end;
$$;

create or replace function public.orgii_upsert_work_item(org_secret text, org_id text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.orgii_validate_org_secret(org_id, org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  insert into public.orgii_work_items (id, org_id, payload)
  values (coalesce(payload->>'id', gen_random_uuid()::text), org_id, payload)
  on conflict (id) do update set
    payload = excluded.payload,
    updated_at = now();
end;
$$;

create or replace function public.orgii_upsert_session_metadata(org_secret text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_access_mode text := payload->>'accessMode';
begin
  if not public.orgii_validate_org_secret(payload->>'orgId', org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  insert into public.orgii_sessions (id, org_id, owner_member_id, source_session_id, access_mode, payload)
  values (payload->>'id', payload->>'orgId', payload->>'ownerMemberId', payload->>'sourceSessionId', v_access_mode, payload)
  on conflict (id) do update set
    access_mode = excluded.access_mode,
    payload = excluded.payload,
    updated_at = now(),
    events_blob_path = case when excluded.access_mode = 'full_replay' then orgii_sessions.events_blob_path else null end,
    events_content_hash = case when excluded.access_mode = 'full_replay' then orgii_sessions.events_content_hash else null end,
    events_updated_at = case when excluded.access_mode = 'full_replay' then orgii_sessions.events_updated_at else null end;
end;
$$;

create or replace function public.orgii_remove_session_metadata(org_secret text, org_id text, owner_member_id text, source_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.orgii_validate_org_secret(org_id, org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  delete from public.orgii_sessions
  where orgii_sessions.org_id = orgii_remove_session_metadata.org_id
    and orgii_sessions.owner_member_id = orgii_remove_session_metadata.owner_member_id
    and orgii_sessions.source_session_id = orgii_remove_session_metadata.source_session_id;
end;
$$;

create or replace function public.orgii_post_chat_message(org_secret text, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.orgii_validate_org_secret(payload->>'orgId', org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  insert into public.orgii_chat_messages (id, org_id, author_member_id, payload)
  values (payload->>'id', payload->>'orgId', payload->>'authorMemberId', payload)
  on conflict (id) do update set payload = excluded.payload;

  return payload;
end;
$$;

create or replace function public.orgii_request_session_snapshot(org_secret text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.orgii_validate_org_secret(payload->>'orgId', org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  insert into public.orgii_session_snapshot_requests (
    request_id, org_id, requester_member_id, owner_member_id, source_session_id, status, payload
  ) values (
    payload->>'requestId', payload->>'orgId', payload->>'requesterMemberId', payload->>'ownerMemberId', payload->>'sourceSessionId', payload->>'status', payload
  ) on conflict (request_id) do update set
    status = excluded.status,
    payload = excluded.payload,
    updated_at = now();
end;
$$;

create or replace function public.orgii_create_session_snapshot(
  org_secret text,
  request_id text,
  org_id text,
  source_session_id text,
  metadata jsonb,
  blob_path text,
  content_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.orgii_validate_org_secret(org_id, org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  insert into public.orgii_session_snapshots (request_id, org_id, source_session_id, blob_path, content_hash, metadata)
  values (request_id, org_id, source_session_id, blob_path, content_hash, metadata)
  on conflict (request_id) do update set
    blob_path = excluded.blob_path,
    content_hash = excluded.content_hash,
    metadata = excluded.metadata;

  update public.orgii_session_snapshot_requests
  set status = 'completed', updated_at = now(), payload = jsonb_set(payload, '{status}', to_jsonb('completed'::text), true)
  where orgii_session_snapshot_requests.request_id = orgii_create_session_snapshot.request_id;
end;
$$;

create or replace function public.orgii_deny_session_snapshot(org_secret text, request_id text, reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  request_org_id text;
begin
  select org_id into request_org_id
  from public.orgii_session_snapshot_requests
  where orgii_session_snapshot_requests.request_id = orgii_deny_session_snapshot.request_id;

  if request_org_id is null or not public.orgii_validate_org_secret(request_org_id, org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  update public.orgii_session_snapshot_requests
  set status = 'denied', error = reason, updated_at = now(),
      payload = jsonb_set(jsonb_set(payload, '{status}', to_jsonb('denied'::text), true), '{error}', to_jsonb(reason), true)
  where orgii_session_snapshot_requests.request_id = orgii_deny_session_snapshot.request_id;
end;
$$;

create or replace function public.orgii_upsert_session_events(
  org_secret text,
  org_id text,
  source_session_id text,
  blob_path text,
  content_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.orgii_validate_org_secret(org_id, org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  update public.orgii_sessions
  set events_blob_path = orgii_upsert_session_events.blob_path,
      events_content_hash = orgii_upsert_session_events.content_hash,
      events_updated_at = now(),
      updated_at = now()
  where orgii_sessions.org_id = orgii_upsert_session_events.org_id
    and orgii_sessions.source_session_id = orgii_upsert_session_events.source_session_id;
end;
$$;

create or replace function public.orgii_get_session_events(
  org_secret text,
  org_id text,
  source_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.orgii_validate_org_secret(org_id, org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  select jsonb_build_object(
    'blobPath', events_blob_path,
    'contentHash', events_content_hash,
    'updatedAt', events_updated_at
  ) into result
  from public.orgii_sessions
  where orgii_sessions.org_id = orgii_get_session_events.org_id
    and orgii_sessions.source_session_id = orgii_get_session_events.source_session_id
    and events_blob_path is not null
    and events_content_hash is not null;

  return coalesce(result, null::jsonb);
end;
$$;

create or replace function public.orgii_update_org_repo_scopes(
  org_secret text,
  org_id text,
  repo_scopes text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org record;
begin
  select * into v_org from public.orgii_orgs where id = org_id;
  if v_org.id is null or v_org.secret_hash <> encode(digest(org_secret, 'sha256'), 'hex') then
    raise exception 'Invalid ORG secret';
  end if;

  update public.orgii_orgs
  set payload = jsonb_set(payload, '{repoScopes}', to_jsonb(repo_scopes), true),
      created_at = created_at
  where id = org_id;
end;
$$;

create or replace function public.orgii_request_repo_join(
  org_secret text,
  org_id text,
  repo_path text,
  requester_member_id text,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_request_id text := coalesce(payload->>'requestId', gen_random_uuid()::text);
  existing_request record;
begin
  if not public.orgii_validate_org_secret(org_id, org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  select * into existing_request
  from public.orgii_repo_join_requests
  where org_id = orgii_request_repo_join.org_id
    and requester_member_id = orgii_request_repo_join.requester_member_id
    and repo_path = orgii_request_repo_join.repo_path
    and status = 'pending'
  limit 1;

  if existing_request.request_id is not null then
    return (select payload from public.orgii_repo_join_requests where request_id = existing_request.request_id);
  end if;

  insert into public.orgii_repo_join_requests (request_id, org_id, requester_member_id, repo_path, status, payload)
  values (next_request_id, org_id, requester_member_id, repo_path, 'pending',
    jsonb_set(payload, '{requestId}', to_jsonb(next_request_id), true));

  return (select payload from public.orgii_repo_join_requests where request_id = next_request_id);
end;
$$;

create or replace function public.orgii_review_repo_join(
  org_secret text,
  request_id text,
  approve boolean,
  reviewer_member_id text,
  review_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_request record;
  new_status text;
begin
  select * into target_request
  from public.orgii_repo_join_requests
  where request_id = orgii_review_repo_join.request_id;

  if target_request.request_id is null then
    raise exception 'Repo join request not found';
  end if;

  if not public.orgii_validate_org_secret(target_request.org_id, org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  new_status := case when approve then 'approved' else 'rejected' end;

  update public.orgii_repo_join_requests
  set status = new_status,
      reviewer_member_id = orgii_review_repo_join.reviewer_member_id,
      review_note = orgii_review_repo_join.review_note,
      reviewed_at = now(),
      payload = jsonb_set(jsonb_set(jsonb_set(
        payload,
        '{status}', to_jsonb(new_status), true),
        '{reviewerMemberId}', to_jsonb(reviewer_member_id), true),
        '{reviewedAt}', to_jsonb(now()::text), true)
  where request_id = orgii_review_repo_join.request_id;

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

  return (select payload from public.orgii_repo_join_requests where request_id = orgii_review_repo_join.request_id);
end;
$$;

create or replace function public.orgii_list_org_state(org_secret text, org_id text, since_timestamp timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := coalesce(since_timestamp, '1970-01-01'::timestamptz);
begin
  if not public.orgii_validate_org_secret(org_id, org_secret) then
    raise exception 'Invalid ORG secret';
  end if;

  return jsonb_build_object(
    'orgs', coalesce((select jsonb_agg(payload) from public.orgii_orgs where id = org_id), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(payload) from public.orgii_members where orgii_members.org_id = orgii_list_org_state.org_id and removed_at is null), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(payload) from public.orgii_invites where orgii_invites.org_id = orgii_list_org_state.org_id and revoked_at is null), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(payload) from public.orgii_projects where orgii_projects.org_id = orgii_list_org_state.org_id and orgii_projects.updated_at >= v_since), '[]'::jsonb),
    'workItems', coalesce((select jsonb_agg(payload) from public.orgii_work_items where orgii_work_items.org_id = orgii_list_org_state.org_id and orgii_work_items.updated_at >= v_since), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(
        orgii_sessions.payload || jsonb_build_object(
          'eventsBlobPath', orgii_sessions.events_blob_path,
          'eventsContentHash', orgii_sessions.events_content_hash,
          'eventsUpdatedAt', orgii_sessions.events_updated_at
        )
      )
      from public.orgii_sessions
      where orgii_sessions.org_id = orgii_list_org_state.org_id
        and orgii_sessions.updated_at >= v_since
    ), '[]'::jsonb),
    'chatMessages', coalesce((select jsonb_agg(payload) from public.orgii_chat_messages where orgii_chat_messages.org_id = orgii_list_org_state.org_id and orgii_chat_messages.created_at >= v_since), '[]'::jsonb),
    'snapshotRequests', coalesce((
      select jsonb_agg(
        orgii_session_snapshot_requests.payload || jsonb_build_object(
          'error', orgii_session_snapshot_requests.error,
          'blobPath', orgii_session_snapshots.blob_path,
          'contentHash', orgii_session_snapshots.content_hash,
          'session', orgii_session_snapshots.metadata
        )
      )
      from public.orgii_session_snapshot_requests
      left join public.orgii_session_snapshots using (request_id)
      where orgii_session_snapshot_requests.org_id = orgii_list_org_state.org_id
        and orgii_session_snapshot_requests.updated_at >= v_since
    ), '[]'::jsonb),
    'repoJoinRequests', coalesce((
      select jsonb_agg(
        orgii_repo_join_requests.payload || jsonb_build_object(
          'status', orgii_repo_join_requests.status,
          'reviewerMemberId', orgii_repo_join_requests.reviewer_member_id,
          'reviewNote', orgii_repo_join_requests.review_note,
          'reviewedAt', orgii_repo_join_requests.reviewed_at
        )
      )
      from public.orgii_repo_join_requests
      where orgii_repo_join_requests.org_id = orgii_list_org_state.org_id
        and orgii_repo_join_requests.created_at >= v_since
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.orgii_sync_version() to anon;
grant execute on function public.orgii_create_org(text, text, text, text, jsonb, jsonb) to anon;
grant execute on function public.orgii_create_invite(text, text, text, integer, timestamptz, jsonb) to anon;
grant execute on function public.orgii_accept_invite(text, text, text, jsonb) to anon;
grant execute on function public.orgii_remove_member(text, text, text) to anon;
grant execute on function public.orgii_upsert_member(text, jsonb) to anon;
grant execute on function public.orgii_upsert_project(text, text, jsonb) to anon;
grant execute on function public.orgii_upsert_work_item(text, text, jsonb) to anon;
grant execute on function public.orgii_upsert_session_metadata(text, jsonb) to anon;
grant execute on function public.orgii_remove_session_metadata(text, text, text, text) to anon;
grant execute on function public.orgii_post_chat_message(text, jsonb) to anon;
grant execute on function public.orgii_request_session_snapshot(text, jsonb) to anon;
grant execute on function public.orgii_create_session_snapshot(text, text, text, text, jsonb, text, text) to anon;
grant execute on function public.orgii_deny_session_snapshot(text, text, text) to anon;
grant execute on function public.orgii_upsert_session_events(text, text, text, text, text) to anon;
grant execute on function public.orgii_get_session_events(text, text, text) to anon;
grant execute on function public.orgii_update_org_repo_scopes(text, text, text[]) to anon;
grant execute on function public.orgii_request_repo_join(text, text, text, text, jsonb) to anon;
grant execute on function public.orgii_review_repo_join(text, text, boolean, text, text) to anon;
grant execute on function public.orgii_list_org_state(text, text, timestamptz) to anon;`;
