-- Team accounts for the OFC Portal.
--
-- Each team member signs in with <username>@coastnation.net and a password the owner sets.
-- Today there is one role, 'gate' (Gate official): scanner + their own stats, nothing else.
-- Like the rest of the site, the tables have RLS on and no policies — the browser can only
-- reach them through the security-definer functions below, which check the session token.

create table if not exists public.team_members (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{1,30}$'),
  name          text not null,
  role          text not null default 'gate' check (role in ('gate')),
  password_hash text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
alter table public.team_members enable row level security;

-- Only a SHA-256 of each session token is stored, so a database read can't be replayed as a login.
create table if not exists public.team_sessions (
  token_hash text primary key,
  member_id  uuid not null references public.team_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.team_sessions enable row level security;
create index if not exists team_sessions_member_idx on public.team_sessions(member_id);

create table if not exists public.team_login_attempts (
  id       bigserial primary key,
  username text not null,
  ok       boolean not null,
  at       timestamptz not null default now()
);
alter table public.team_login_attempts enable row level security;
create index if not exists team_login_attempts_user_at_idx on public.team_login_attempts(username, at);

-- who let each ticket in (null = scanned from the owner/staff admin)
alter table public.tickets add column if not exists scanned_by uuid references public.team_members(id) on delete set null;
create index if not exists tickets_scanned_by_idx on public.tickets(scanned_by);

/* ---------------- helpers ---------------- */

-- "J4ss@CoastNation.net" or "j4ss" -> "j4ss"; anything on another domain -> null
create or replace function public._team_username(p_login text)
returns text language sql immutable set search_path to 'public', 'extensions' as $$
  select case
    when lower(trim(coalesce(p_login,''))) ~ '^[a-z0-9][a-z0-9._-]{1,30}@coastnation\.net$'
      then split_part(lower(trim(p_login)), '@', 1)
    when lower(trim(coalesce(p_login,''))) ~ '^[a-z0-9][a-z0-9._-]{1,30}$'
      then lower(trim(p_login))
    else null end;
$$;

create or replace function public._team_member(p_token text)
returns public.team_members language plpgsql stable security definer
set search_path to 'public', 'extensions' as $$
declare m public.team_members%rowtype;
begin
  select tm.* into m
    from public.team_sessions s join public.team_members tm on tm.id = s.member_id
   where s.token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex')
     and s.expires_at > now() and tm.active;
  if not found then raise exception 'SESSION_EXPIRED' using errcode = '28000'; end if;
  return m;
end;
$$;

/* ---------------- sign in / out ---------------- */

create or replace function public.team_login(p_email text, p_password text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_user text := public._team_username(p_email); v_fails int; m public.team_members%rowtype; v_token text;
begin
  if v_user is null then
    perform pg_sleep(0.6);
    return jsonb_build_object('ok', false, 'message', 'Use your @coastnation.net email.');
  end if;

  delete from public.team_login_attempts where at < now() - interval '2 hours';
  select count(*) into v_fails from public.team_login_attempts
   where username = v_user and not ok and at > now() - interval '15 minutes';
  if v_fails >= 6 then
    perform pg_sleep(1.5);
    return jsonb_build_object('ok', false, 'locked', true,
      'message', 'Too many wrong passwords. Wait 15 minutes, or ask the owner to reset it.');
  end if;

  select * into m from public.team_members where username = v_user;
  if m.id is null or m.password_hash <> crypt(coalesce(p_password,''), m.password_hash) then
    insert into public.team_login_attempts (username, ok) values (v_user, false);
    perform pg_sleep(0.8);
    return jsonb_build_object('ok', false, 'message', 'Wrong email or password.');
  end if;
  -- only say "switched off" once the password is right, so it can't be used to probe usernames
  if not m.active then
    return jsonb_build_object('ok', false, 'message', 'This account has been switched off. Talk to the owner.');
  end if;

  insert into public.team_login_attempts (username, ok) values (v_user, true);
  delete from public.team_sessions where expires_at < now();
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.team_sessions (token_hash, member_id, expires_at)
       values (encode(digest(v_token, 'sha256'), 'hex'), m.id, now() + interval '24 hours');
  update public.team_members set last_login_at = now() where id = m.id;

  return jsonb_build_object('ok', true, 'token', v_token, 'name', m.name, 'role', m.role,
                            'email', m.username || '@coastnation.net');
end;
$$;

create or replace function public.team_logout(p_token text)
returns jsonb language sql security definer set search_path to 'public', 'extensions' as $$
  delete from public.team_sessions where token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex');
  select jsonb_build_object('ok', true);
$$;

create or replace function public.team_me(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare m public.team_members%rowtype;
begin
  m := public._team_member(p_token);
  return jsonb_build_object('name', m.name, 'role', m.role, 'email', m.username || '@coastnation.net');
end;
$$;

/* ---------------- gate official ---------------- */

-- events worth scanning for: published, from yesterday onwards (a night event runs past midnight)
create or replace function public.team_events(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
begin
  perform public._team_member(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'event_date', e.event_date,
                                        'start_time', e.start_time, 'venue', e.venue, 'image_url', e.image_url)
                     order by e.event_date, e.start_time nulls last)
      from public.events e
     where e.status = 'published' and e.event_date >= current_date - 1), '[]'::jsonb);
end;
$$;

create or replace function public.team_stats(p_token text, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare m public.team_members%rowtype;
begin
  m := public._team_member(p_token);
  return jsonb_build_object(
    'total',      (select count(*) from public.tickets where event_id = p_event_id and status in ('valid','used')),
    'checked_in', (select count(*) from public.tickets where event_id = p_event_id and status = 'used'),
    'mine',       (select count(*) from public.tickets where event_id = p_event_id and status = 'used' and scanned_by = m.id),
    'recent', coalesce((
      select jsonb_agg(r order by r.used_at desc) from (
        select t.code, tt.name as type, o.buyer_name as buyer, t.used_at
          from public.tickets t
          join public.ticket_types tt on tt.id = t.ticket_type_id
          join public.orders o on o.id = t.order_id
         where t.event_id = p_event_id and t.scanned_by = m.id and t.status = 'used'
         order by t.used_at desc limit 8) r), '[]'::jsonb));
end;
$$;

-- Accepts the QR link (verify.html?t=…), a bare token, or the short CN… code.
create or replace function public.team_scan(p_token text, p_event_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare m public.team_members%rowtype; v_t public.tickets%rowtype;
        v_in text := trim(coalesce(p_code,'')); v_tok text;
        v_event text; v_type text; v_buyer text; v_by text;
begin
  m := public._team_member(p_token);
  if m.role <> 'gate' then raise exception 'NOT_ALLOWED' using errcode = '28000'; end if;

  v_tok := substring(v_in from '[?&]t=([A-Za-z0-9_-]+)');
  if v_tok is null and v_in ~ '^[A-Za-z0-9_-]{40,}$' then v_tok := v_in; end if;
  if v_tok is not null then
    select * into v_t from public.tickets where verify_token = v_tok for update;
  else
    select * into v_t from public.tickets where upper(code) = upper(v_in) for update;
  end if;
  if not found then return jsonb_build_object('result','not_found'); end if;

  select e.name, tt.name, o.buyer_name into v_event, v_type, v_buyer
    from public.events e, public.ticket_types tt, public.orders o
   where e.id = v_t.event_id and tt.id = v_t.ticket_type_id and o.id = v_t.order_id;

  if p_event_id is not null and v_t.event_id <> p_event_id then
    return jsonb_build_object('result','wrong_event','code',v_t.code,'event',v_event,'type',v_type,'buyer',v_buyer);
  end if;
  if v_t.status = 'used' then
    select name into v_by from public.team_members where id = v_t.scanned_by;
    return jsonb_build_object('result','already_used','code',v_t.code,'event',v_event,'type',v_type,
                              'buyer',v_buyer,'used_at',v_t.used_at,'scanned_by',v_by);
  elsif v_t.status = 'void' then
    return jsonb_build_object('result','void','code',v_t.code,'event',v_event,'type',v_type,'buyer',v_buyer);
  end if;

  update public.tickets set status = 'used', used_at = now(), scanned_by = m.id where id = v_t.id;
  return jsonb_build_object('result','valid','code',v_t.code,'event',v_event,'type',v_type,'buyer',v_buyer);
end;
$$;

/* ---------------- owner: manage the team ---------------- */

create or replace function public.admin_team_list(p_pin text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
begin
  perform public._require_owner(p_pin);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', tm.id, 'username', tm.username, 'email', tm.username || '@coastnation.net',
             'name', tm.name, 'role', tm.role, 'active', tm.active,
             'created_at', tm.created_at, 'last_login_at', tm.last_login_at,
             'scans', (select count(*) from public.tickets t where t.scanned_by = tm.id and t.status = 'used'))
           order by tm.created_at)
      from public.team_members tm), '[]'::jsonb);
end;
$$;

-- p_id null = add; otherwise update name/role/active. p_password optional on update (blank = keep).
create or replace function public.admin_team_save(p_pin text, p_id uuid, p_username text, p_name text,
                                                  p_role text, p_active boolean, p_password text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_user text := public._team_username(p_username); v_id uuid;
begin
  perform public._require_owner(p_pin);
  if coalesce(trim(p_name),'') = '' then return jsonb_build_object('ok', false, 'message', 'Add their name.'); end if;
  if coalesce(p_role,'') not in ('gate') then return jsonb_build_object('ok', false, 'message', 'Pick a role.'); end if;
  if coalesce(p_password,'') <> '' and length(p_password) < 8 then
    return jsonb_build_object('ok', false, 'message', 'Passwords need at least 8 characters.');
  end if;

  if p_id is null then
    if v_user is null then
      return jsonb_build_object('ok', false, 'message', 'Usernames are 2–31 characters: letters, numbers, dots, dashes, underscores.');
    end if;
    if coalesce(p_password,'') = '' then return jsonb_build_object('ok', false, 'message', 'Set a password for them.'); end if;
    if exists (select 1 from public.team_members where username = v_user) then
      return jsonb_build_object('ok', false, 'message', v_user || '@coastnation.net is already on the team.');
    end if;
    insert into public.team_members (username, name, role, active, password_hash)
         values (v_user, trim(p_name), p_role, coalesce(p_active, true), crypt(p_password, gen_salt('bf', 10)))
      returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'email', v_user || '@coastnation.net');
  end if;

  update public.team_members
     set name = trim(p_name), role = p_role, active = coalesce(p_active, active),
         password_hash = case when coalesce(p_password,'') <> '' then crypt(p_password, gen_salt('bf', 10)) else password_hash end
   where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'message', 'That team member no longer exists.'); end if;
  -- switching someone off or changing their password signs them out everywhere
  if coalesce(p_active, true) = false or coalesce(p_password,'') <> '' then
    delete from public.team_sessions where member_id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

create or replace function public.admin_team_delete(p_pin text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
begin
  perform public._require_owner(p_pin);
  delete from public.team_members where id = p_id;   -- sessions cascade; tickets keep their scan, scanned_by -> null
  return jsonb_build_object('ok', found);
end;
$$;

/* ---------------- who may call what ---------------- */
revoke all on function public._team_username(text) from public, anon, authenticated;
revoke all on function public._team_member(text) from public, anon, authenticated;
grant execute on function public.team_login(text, text), public.team_logout(text), public.team_me(text),
                          public.team_events(text), public.team_stats(text, uuid), public.team_scan(text, uuid, text),
                          public.admin_team_list(text), public.admin_team_delete(text, uuid),
                          public.admin_team_save(text, uuid, text, text, text, boolean, text)
  to anon, authenticated;
