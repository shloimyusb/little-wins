-- Little Wins: add a second parent to existing families. Preserves progress and PINs.
begin;
-- One additional verified parent may share a family. Invitations are email-bound.
create table if not exists little_wins_private.parent_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 family_id uuid not null references little_wins_private.families(id) on delete cascade,
 joined_at timestamptz not null default now()
);
create table if not exists little_wins_private.parent_invites (
 family_id uuid primary key references little_wins_private.families(id) on delete cascade,
 email text not null, token_hash bytea not null unique, expires_at timestamptz not null
);
alter table little_wins_private.devices add column if not exists parent_auth_id uuid references auth.users(id) on delete set null;
update little_wins_private.devices d set parent_auth_id=f.owner_id from little_wins_private.families f where d.family_id=f.id and d.parent_auth_id is null;
alter table little_wins_private.parent_members enable row level security;
alter table little_wins_private.parent_invites enable row level security;
revoke all on all tables in schema little_wins_private from public,anon,authenticated;
create or replace function public.lw_parent_connect(p_device_token text default null,p_seed jsonb default null,p_parent_pin text default null,p_child_pin text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); f little_wins_private.families; d little_wins_private.devices; state jsonb; members jsonb:='[]'; chores jsonb:='[]'; rewards jsonb:='[]'; v jsonb; k text; ids text[]:=array[]::text[]; item_ids text[]; token text; session_token text; role_name text; points integer;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then return little_wins_private.err('email_confirmation','Confirm your parent email and sign in first.',401);end if;
 -- Reject a different family's device before creating any new family rows.
 if p_device_token is not null then
  select * into d from little_wins_private.devices where token_hash=extensions.digest(p_device_token,'sha256') and not revoked;
  if d.id is null then return little_wins_private.err('unauthorized','Link this tablet again using parent email.',401);end if;
  if not exists(select 1 from little_wins_private.families where id=d.family_id and (owner_id=uid or exists(select 1 from little_wins_private.parent_members m where m.family_id=d.family_id and m.user_id=uid))) then return little_wins_private.err('family_mismatch','This tablet belongs to another family. Use another browser profile.');end if;
 end if;
 -- Serialize first-family creation for the same verified parent, including simultaneous devices.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select * into f from little_wins_private.families where owner_id=uid or id in (select family_id from little_wins_private.parent_members where user_id=uid) for update;
 if f.id is not null and f.owner_id<>uid and not exists(select 1 from little_wins_private.parent_members where family_id=f.id and user_id=uid) then return little_wins_private.err('unauthorized','Parent access was removed. Sign in again.',401);end if;
 if f.id is null then
  if p_seed is null then return jsonb_build_object('ok',true,'needsFamilySetup',true);end if;
  if coalesce(p_parent_pin,'')!~'^\d{6,32}$' or coalesce(p_child_pin,'')!~'^\d{4,32}$' then return little_wins_private.err('invalid_pin','Choose a Parent PIN of 6+ digits and a child PIN of 4+ digits.',400);end if;
  if pg_column_size(p_seed)>262144 or jsonb_typeof(p_seed->'members') is distinct from 'array' or jsonb_array_length(p_seed->'members') not between 1 and 20 then return little_wins_private.err('invalid','Invalid family setup.',400);end if;
  for v in select value from jsonb_array_elements(p_seed->'members') loop
   if coalesce(v->>'id','')!~'^[A-Za-z0-9_-]{1,100}$' or v->>'id'=any(ids) or coalesce(length(trim(v->>'name')),0) not between 1 and 100 then return little_wins_private.err('invalid','Invalid child profile.',400);end if;
   ids:=array_append(ids,v->>'id');members:=members||jsonb_build_array(jsonb_build_object('id',v->>'id','name',trim(v->>'name'),'icon',left(coalesce(v->>'icon','🌟'),100),'points',0,'redemptions',0));
  end loop;
  foreach k in array array['chores','rewards'] loop
   if jsonb_typeof(p_seed->k) is distinct from 'array' or jsonb_array_length(p_seed->k)>200 then return little_wins_private.err('invalid','Invalid starting settings.',400);end if;
   item_ids:=array[]::text[];
   for v in select value from jsonb_array_elements(p_seed->k) loop
    if coalesce(v->>'id','')!~'^[A-Za-z0-9_-]{1,100}$' or v->>'id'=any(item_ids) or not coalesce(v->>'member'=any(ids),false) or coalesce(length(trim(v->>'name')),0) not between 1 and 100 or jsonb_typeof(v->'points') is distinct from 'number' or v->>'points'!~'^\d+$' then return little_wins_private.err('invalid','Invalid chore or reward.',400);end if;
    points:=(v->>'points')::integer;if points not between 1 and 10000 then return little_wins_private.err('invalid','Invalid points.',400);end if;
    item_ids:=array_append(item_ids,v->>'id');
    v:=jsonb_build_object('id',v->>'id','member',v->>'member','name',trim(v->>'name'),'points',points,'icon',left(coalesce(v->>'icon','✨'),100),'detail',left(coalesce(v->>'detail',''),500),'syncVersion',1,'dailyLimit',case when k='chores' then 1 else null end,'weeklyLimit',null,'timerRequired',false,'minutes',0,'deadline',null);
    if k='chores' then chores:=chores||jsonb_build_array(v);else rewards:=rewards||jsonb_build_array(v);end if;
   end loop;
  end loop;
  state:=jsonb_build_object('members',members,'active',ids[1],'chores',chores,'rewards',rewards,'completions','[]'::jsonb,'redemptionLog','[]'::jsonb,'rewardRequests','[]'::jsonb,'pointAdjustments','[]'::jsonb,'timers','[]'::jsonb,'timeZone','America/New_York','childRewardsVersion',1,'childChoresVersion',1,'removedJamie',true);
  insert into little_wins_private.families(owner_id,state) values(uid,state) returning * into f;
  insert into little_wins_private.pins(family_id,principal,pin_hash,pin_length) values(f.id,'parent',extensions.crypt(p_parent_pin,extensions.gen_salt('bf',10)),length(p_parent_pin));
  foreach role_name in array ids loop insert into little_wins_private.pins(family_id,principal,pin_hash,pin_length) values(f.id,role_name,extensions.crypt(p_child_pin,extensions.gen_salt('bf',10)),length(p_child_pin));end loop;
 end if;
 if p_device_token is not null then
  select * into d from little_wins_private.devices where token_hash=extensions.digest(p_device_token,'sha256') and not revoked;
  if d.id is null then return little_wins_private.err('unauthorized','This tablet link expired. Sign out of the device and link it again.',401);end if;
  if d.family_id<>f.id then return little_wins_private.err('family_mismatch','This tablet belongs to another family. Use another browser profile.',409);end if;
  token:=p_device_token;
 else
  token:=encode(extensions.gen_random_bytes(32),'hex');insert into little_wins_private.devices(family_id,token_hash) values(f.id,extensions.digest(token,'sha256')) returning * into d;
 end if;
 update little_wins_private.devices set parent_auth_id=uid where id=d.id;
 session_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into little_wins_private.sessions(token_hash,device_id,role,expires_at) values(extensions.digest(session_token,'sha256'),d.id,'parent',clock_timestamp()+interval '30 minutes');
 return jsonb_build_object('ok',true,'familyId',f.id,'deviceId',d.id,'deviceToken',token,'sessionToken',session_token,'role','parent','member',null,'parentEmail',(select email from auth.users where id=uid));
end$$;

create or replace function little_wins_private.manage_parents(family uuid, action text, data jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare target text; code text; guest uuid; owner uuid;
begin
 select owner_id into owner from little_wins_private.families where id=family;
 if action='parents/list' then
  return jsonb_build_object('ok',true,'parents',coalesce((select jsonb_agg(jsonb_build_object('email',u.email,'owner',u.id=owner)) from auth.users u where u.id=owner or u.id in(select user_id from little_wins_private.parent_members where family_id=family)),'[]'::jsonb),'invitation',(select jsonb_build_object('email',email,'expiresAt',expires_at) from little_wins_private.parent_invites where family_id=family and expires_at>clock_timestamp()));
 elsif action='parents/invite' then
  target:=lower(trim(data->>'email'));
  if target is null or length(target)>254 or target!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return little_wins_private.err('invalid','Enter the other parent’s email address.',400);end if;
  if exists(select 1 from little_wins_private.parent_members where family_id=family) then return little_wins_private.err('parent_limit','This family already has two parents.');end if;
  if exists(select 1 from auth.users where id=owner and lower(email)=target) then return little_wins_private.err('invalid','Use the other parent’s email address.',400);end if;
  code:=encode(extensions.gen_random_bytes(32),'hex');
  insert into little_wins_private.parent_invites(family_id,email,token_hash,expires_at) values(family,target,extensions.digest(code,'sha256'),clock_timestamp()+interval '24 hours') on conflict(family_id) do update set email=excluded.email,token_hash=excluded.token_hash,expires_at=excluded.expires_at;
  return jsonb_build_object('ok',true,'code',code,'email',target);
 elsif action='parents/cancel' then
  delete from little_wins_private.parent_invites where family_id=family;return jsonb_build_object('ok',true);
 elsif action='parents/remove' then
  select user_id into guest from little_wins_private.parent_members where family_id=family for update;
  if guest is null then return little_wins_private.err('missing','No second parent is linked.');end if;
  update little_wins_private.devices set revoked=true where family_id=family and parent_auth_id=guest;
  delete from little_wins_private.parent_members where family_id=family;
  delete from little_wins_private.parent_invites where family_id=family;
  return jsonb_build_object('ok',true);
 end if;
 return little_wins_private.err('unsupported','Unsupported parent setting.',400);
end$$;

create or replace function public.lw_parent_accept_invite(p_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); email_address text; invitation little_wins_private.parent_invites; family uuid;
begin
 select lower(email) into email_address from auth.users where id=uid and email_confirmed_at is not null;
 if uid is null or email_address is null then return little_wins_private.err('email_confirmation','Confirm your parent email and sign in first.',401);end if;
 if coalesce(p_code,'')!~'^[a-f0-9]{64}$' then return little_wins_private.err('invalid_invite','The invitation code is invalid or expired.',400);end if;
 -- Match identity AND random code before taking the family lock; do not reveal another email’s invitation.
 select * into invitation from little_wins_private.parent_invites where token_hash=extensions.digest(p_code,'sha256') and email=email_address and expires_at>clock_timestamp();
 if invitation.family_id is null then return little_wins_private.err('invalid_invite','The invitation code is invalid, expired, or for a different email.',400);end if;
 -- Lock order matches first-family creation, then all other family mutations.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select id into family from little_wins_private.families where id=invitation.family_id for update;
 select * into invitation from little_wins_private.parent_invites where family_id=family and token_hash=extensions.digest(p_code,'sha256') and email=email_address and expires_at>clock_timestamp() for update;
 if invitation.family_id is null then return little_wins_private.err('invalid_invite','The invitation code was used, canceled, or expired.',400);end if;
 if exists(select 1 from little_wins_private.families where owner_id=uid) or exists(select 1 from little_wins_private.parent_members where user_id=uid) then return little_wins_private.err('already_linked','This email already belongs to a family. Use an email without a separate family.');end if;
 if exists(select 1 from little_wins_private.parent_members where family_id=family) then return little_wins_private.err('parent_limit','This family already has two parents.');end if;
 insert into little_wins_private.parent_members(user_id,family_id) values(uid,family);
 delete from little_wins_private.parent_invites where family_id=family;
 return jsonb_build_object('ok',true);
end$$;

create or replace function public.lw_api(p_action text,p_data jsonb default '{}'::jsonb,p_device_token text default null,p_session_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare f little_wins_private.families;d little_wins_private.devices;a little_wins_private.sessions;pin little_wins_private.pins;receipt little_wins_private.receipts;token text;principal text;raw_pin text;result jsonb;fingerprint bytea;new_state jsonb;is_parent boolean;known bigint;
begin
 if pg_column_size(p_data)>262144 or jsonb_typeof(p_data) is distinct from 'object' then return little_wins_private.err('invalid','Invalid request.',400);end if;
 if p_action in ('device/accounts','login') then
  select * into d from little_wins_private.devices where token_hash=extensions.digest(coalesce(p_device_token,''),'sha256') and not revoked;
  if d.id is null then return little_wins_private.err('unauthorized','Link this tablet using your parent email first.',401);end if;
  select * into f from little_wins_private.families where id=d.family_id;
  if p_action='device/accounts' then return jsonb_build_object('ok',true,'familyId',f.id,'members',(select jsonb_agg(jsonb_build_object('id',m->>'id','name',m->>'name','icon',m->>'icon','theme',m->>'theme')) from jsonb_array_elements(f.state->'members') m),'pinLengths',(select jsonb_object_agg(p.principal,p.pin_length) from little_wins_private.pins p where family_id=f.id));end if;
  principal:=p_data->>'principal';raw_pin:=p_data->>'pin';
  select * into pin from little_wins_private.pins where family_id=f.id and little_wins_private.pins.principal=principal for update;
  if pin.principal is null then return little_wins_private.err('wrong_pin','Incorrect PIN.',401);end if;
  if pin.locked_until>clock_timestamp() then return little_wins_private.err('locked','Wait one minute before trying again.',429);end if;
  if coalesce(raw_pin,'')!~'^\d{4,32}$' or extensions.crypt(raw_pin,pin.pin_hash) is distinct from pin.pin_hash then
   update little_wins_private.pins set attempts=(pin.attempts+1)%5,locked_until=case when pin.attempts+1>=5 then clock_timestamp()+interval '1 minute' else null end where family_id=f.id and little_wins_private.pins.principal=principal;
   return little_wins_private.err('wrong_pin','Incorrect PIN.',401);
  end if;
  update little_wins_private.pins set attempts=0,locked_until=null where family_id=f.id and little_wins_private.pins.principal=principal;
  token:=encode(extensions.gen_random_bytes(32),'hex');is_parent:=principal='parent';
  insert into little_wins_private.sessions(token_hash,device_id,role,member_id,expires_at) values(extensions.digest(token,'sha256'),d.id,case when is_parent then 'parent' else 'child' end,case when is_parent then null else principal end,clock_timestamp()+case when is_parent then interval '30 minutes' else interval '2 hours' end);
  return jsonb_build_object('ok',true,'sessionToken',token,'role',case when is_parent then 'parent' else 'child' end,'member',case when is_parent then null else principal end);
 end if;
 if p_action='logout' then delete from little_wins_private.sessions where token_hash=extensions.digest(coalesce(p_session_token,''),'sha256');return jsonb_build_object('ok',true);end if;
 select s.* into a from little_wins_private.sessions s join little_wins_private.devices v on v.id=s.device_id and not v.revoked where s.token_hash=extensions.digest(coalesce(p_session_token,''),'sha256') and s.expires_at>clock_timestamp();
 if a.device_id is null then return little_wins_private.err('unauthorized','Sign in again.',401);end if;
 select * into d from little_wins_private.devices where id=a.device_id;
 select * into f from little_wins_private.families where id=d.family_id for update;
 if p_action like 'parents/%' then
  if a.role<>'parent' then return little_wins_private.err('forbidden','Parent login required.',403);end if;
  return little_wins_private.manage_parents(f.id,p_action,p_data);
 end if;
 if p_action='snapshot' then
  known:=(p_data->>'knownRevision')::bigint;if known=f.revision then return jsonb_build_object('ok',true,'revision',f.revision,'unchanged',true);end if;
  return jsonb_build_object('ok',true,'revision',f.revision,'state',little_wins_private.project(f.state,a.role,a.member_id));
 end if;
 if p_action='account/pin' then
  if a.role<>'parent' then return little_wins_private.err('forbidden','Parent login required.',403);end if;
  principal:=p_data->>'principal';raw_pin:=p_data->>'pin';is_parent:=principal='parent';
  if principal is null or (not is_parent and little_wins_private.member_index(f.state,principal) is null) or coalesce(raw_pin,'')!~(case when is_parent then '^\d{6,32}$' else '^\d{4,32}$' end) then return little_wins_private.err('invalid_pin','Choose a valid PIN.',400);end if;
  update little_wins_private.pins set pin_hash=extensions.crypt(raw_pin,extensions.gen_salt('bf',10)),pin_length=length(raw_pin),attempts=0,locked_until=null where family_id=f.id and little_wins_private.pins.principal=principal;
  delete from little_wins_private.sessions ss using little_wins_private.devices dd where ss.device_id=dd.id and dd.family_id=f.id and ss.token_hash<>a.token_hash and ((is_parent and ss.role='parent') or (not is_parent and ss.role='child' and ss.member_id=principal));
  return jsonb_build_object('ok',true,'principal',principal,'pinLength',length(raw_pin));
 end if;
 if p_action='command' then
  if coalesce(length(p_data->>'id'),0) not between 1 and 100 or jsonb_typeof(p_data->'data') is distinct from 'object' then return little_wins_private.err('invalid','Invalid command.',400);end if;
  fingerprint:=extensions.digest(jsonb_build_object('type',p_data->'type','data',p_data->'data')::text,'sha256');
  select * into receipt from little_wins_private.receipts where family_id=f.id and operation_id=p_data->>'id';
  if receipt.operation_id is not null then
   if receipt.device_id<>d.id or receipt.fingerprint<>fingerprint then return little_wins_private.err('id_reused','Operation ID already used.');end if;
   return receipt.result||jsonb_build_object('replayed',true);
  end if;
  begin
   if p_data->>'type'='revokeDevice' then
    if a.role<>'parent' then perform little_wins_private.fail('forbidden','Parent login required.');end if;
    if p_data->'data'->>'deviceId'=d.id::text then perform little_wins_private.fail('invalid','Cannot revoke this tablet.');end if;
    update little_wins_private.devices set revoked=true where id=(p_data->'data'->>'deviceId')::uuid and family_id=f.id;
   else
    new_state:=little_wins_private.apply(f.state,a.role,a.member_id,p_data);
    update little_wins_private.families set state=new_state,revision=revision+1 where id=f.id returning * into f;
   end if;
   result:=jsonb_build_object('ok',true,'revision',f.revision);
  exception when sqlstate 'P0001' then result:=(sqlerrm::jsonb)||jsonb_build_object('ok',false,'revision',f.revision,'status',409);
  when data_exception or check_violation or not_null_violation then result:=little_wins_private.err('invalid','Invalid command values.',400)||jsonb_build_object('revision',f.revision);
  end;
  insert into little_wins_private.receipts(family_id,operation_id,device_id,fingerprint,result) values(f.id,p_data->>'id',d.id,fingerprint,result);
  return result;
 end if;
 return little_wins_private.err('unsupported','Unsupported request.',400);
end$$;

create or replace function public.lw_parent_revoke_sessions() returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();family uuid;
begin
 if uid is null or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then return little_wins_private.err('unauthorized','Verified parent login required.',401);end if;
 select id into family from little_wins_private.families where owner_id=uid or id in (select family_id from little_wins_private.parent_members where user_id=uid) for update;
 if family is not null then
  delete from little_wins_private.sessions using little_wins_private.devices d where device_id=d.id and d.family_id=family;
 end if;
 return jsonb_build_object('ok',true);
end$$;
revoke all on all functions in schema little_wins_private from public,anon,authenticated;
revoke all on function public.lw_parent_accept_invite(text) from public,anon;
grant execute on function public.lw_parent_accept_invite(text) to authenticated;
notify pgrst,'reload schema';
commit;
