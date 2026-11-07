-- OFC Portal without a login: open the page and scan.
--
-- The gate check-ins switch is now the lock. While it's ON, anyone opening the portal gets a
-- session for a shared "Gate" team member (no usable password) and can scan + admit. While
-- it's OFF, no session is handed out and team_scan / team_accept refuse anyway.

insert into public.team_members (username, name, role, password_hash, active)
values ('gate', 'Gate', 'gate', crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf', 10)), true)
on conflict (username) do nothing;

-- tiny public check so a closed portal knows when to come alive
create or replace function public.gate_status()
returns jsonb language sql stable security definer set search_path to 'public', 'extensions' as $$
  select jsonb_build_object('open', public._gate_open());
$$;

create or replace function public.gate_open_session()
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_member uuid; v_token text;
begin
  if not public._gate_open() then return jsonb_build_object('ok', false, 'closed', true); end if;
  select id into v_member from public.team_members where username = 'gate' and active;
  if v_member is null then return jsonb_build_object('ok', false, 'message', 'The gate account is switched off.'); end if;

  delete from public.team_sessions where expires_at < now();
  -- the page is public: cap how many open sessions can pile up
  if (select count(*) from public.team_sessions where member_id = v_member and created_at > now() - interval '10 minutes') >= 60 then
    return jsonb_build_object('ok', false, 'message', 'Too many devices just opened the scanner. Wait a minute and try again.');
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.team_sessions (token_hash, member_id, expires_at)
       values (encode(digest(v_token, 'sha256'), 'hex'), v_member, now() + interval '18 hours');
  return jsonb_build_object('ok', true, 'token', v_token, 'name', 'Gate', 'role', 'gate');
end;
$$;

grant execute on function public.gate_status(), public.gate_open_session() to anon, authenticated;

-- the shared Gate account isn't a person: keep it out of the Team tab so it can't be removed
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
      from public.team_members tm where tm.username <> 'gate'), '[]'::jsonb);
end;
$$;
