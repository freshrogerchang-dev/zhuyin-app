-- Fresh project only. Production learning data is transferred separately, never committed.
begin;
create table public.zhuyin_app_state (
  user_id uuid not null references auth.users(id),
  id smallint not null default 1 check(id=1),
  coins integer not null default 8,
  updated_at timestamptz not null default now(),
  primary key(user_id,id)
);
create table public.zhuyin_app_char_progress (
  user_id uuid not null references auth.users(id),
  character text not null,
  best_reward integer not null default 0,
  perfect_count integer not null default 0,
  attempt_count integer not null default 0,
  last_reward smallint,
  updated_at timestamptz not null default now(),
  primary key(user_id,character)
);
alter table public.zhuyin_app_state enable row level security;
alter table public.zhuyin_app_char_progress enable row level security;
revoke all on public.zhuyin_app_state,public.zhuyin_app_char_progress from public,anon,authenticated;
grant select,insert,update on public.zhuyin_app_state,public.zhuyin_app_char_progress to authenticated;
create policy owner_read on public.zhuyin_app_state for select to authenticated using ((select auth.uid())=user_id);
create policy owner_insert on public.zhuyin_app_state for insert to authenticated with check ((select auth.uid())=user_id);
create policy owner_update on public.zhuyin_app_state for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy owner_read on public.zhuyin_app_char_progress for select to authenticated using ((select auth.uid())=user_id);
create policy owner_insert on public.zhuyin_app_char_progress for insert to authenticated with check ((select auth.uid())=user_id);
create policy owner_update on public.zhuyin_app_char_progress for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create schema zhuyin_private;
revoke all on schema zhuyin_private from public,anon,authenticated;
create table zhuyin_private.legacy_import (
  id boolean primary key default true check(id),
  owner_email text not null,
  snapshot jsonb,
  ready boolean not null default false,
  imported_at timestamptz,
  claimed_by uuid references auth.users(id),
  claimed_at timestamptz
);
alter table zhuyin_private.legacy_import enable row level security;
revoke all on zhuyin_private.legacy_import from public,anon,authenticated;
insert into zhuyin_private.legacy_import(owner_email) values ('freshrogerchang@gmail.com');

-- This one-time privileged operation is intentionally private. It trusts only
-- auth.uid() and verified Google identity records, never caller email/metadata.
create function zhuyin_private.claim_legacy() returns boolean
language plpgsql security definer set search_path='' as $$
declare
  caller uuid := auth.uid();
  archive zhuyin_private.legacy_import%rowtype;
begin
  if caller is null then raise exception 'Login required' using errcode='42501'; end if;
  select * into strict archive from zhuyin_private.legacy_import where id=true for update;
  if archive.claimed_by is not null then return archive.claimed_by=caller; end if;
  if not exists (
    select 1 from auth.users u join auth.identities i on i.user_id=u.id
    where u.id=caller and u.email_confirmed_at is not null
      and lower(u.email)=archive.owner_email and i.provider='google'
      and lower(i.identity_data->>'email')=archive.owner_email
      and i.identity_data->>'email_verified'='true'
  ) then return false; end if;
  if not archive.ready then raise exception 'Legacy import not ready'; end if;
  -- Fail on conflicts instead of overwriting any newer account progress.
  insert into public.zhuyin_app_state(user_id,id,coins,updated_at)
    select caller,id,coins,updated_at from jsonb_to_recordset(archive.snapshot->'state')
      as x(id smallint,coins integer,updated_at timestamptz);
  insert into public.zhuyin_app_char_progress(user_id,character,best_reward,perfect_count,attempt_count,last_reward,updated_at)
    select caller,character,best_reward,perfect_count,attempt_count,last_reward,updated_at
      from jsonb_to_recordset(archive.snapshot->'progress') as x(character text,best_reward integer,perfect_count integer,attempt_count integer,last_reward smallint,updated_at timestamptz);
  update zhuyin_private.legacy_import set claimed_by=caller,claimed_at=now() where id=true;
  return true;
end $$;
revoke all on function zhuyin_private.claim_legacy() from public,anon,authenticated;
grant usage on schema zhuyin_private to authenticated;
grant execute on function zhuyin_private.claim_legacy() to authenticated;
create function public.zhuyin_claim_legacy() returns boolean
language sql security invoker set search_path='' as $$ select zhuyin_private.claim_legacy(); $$;
revoke all on function public.zhuyin_claim_legacy() from public,anon,authenticated;
grant execute on function public.zhuyin_claim_legacy() to authenticated;
commit;
