-- Gate check-ins switch + two-step scanning for gate officials.
--
-- The owner (or staff PIN) turns gate check-ins on from the admin. While it's off, the
-- OFC Portal can't check or admit anything. Scanning is now two steps:
--   team_scan   looks the ticket up and changes nothing
--   team_accept the official tapped Accept — only now is the ticket spent
-- team_accept re-reads the ticket under a row lock, so if another gate admitted it in the
-- seconds between scan and Accept, the second official is told it's already been scanned.

insert into public.settings (key, value, is_public, updated_at)
values ('gate_checkin_open', 'false', true, now())
on conflict (key) do nothing;

create or replace function public._gate_open()
returns boolean language sql stable security definer set search_path to 'public', 'extensions' as $$
  select coalesce((select value = 'true' from public.settings where key = 'gate_checkin_open'), false);
$$;

create or replace function public.admin_set_gate_open(p_pin text, p_open boolean)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
begin
  perform public._require_pin(p_pin);       -- owner or staff
  insert into public.settings (key, value, is_public, updated_at)
  values ('gate_checkin_open', case when p_open then 'true' else 'false' end, true, now())
  on conflict (key) do update set value = excluded.value, is_public = true, updated_at = now();
  return jsonb_build_object('ok', true, 'open', p_open);
end;
$$;

-- shared lookup: link (verify.html?t=…), bare token, or short code
create or replace function public._find_ticket(p_code text, p_lock boolean)
returns public.tickets language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_in text := trim(coalesce(p_code,'')); v_tok text; t public.tickets%rowtype;
begin
  v_tok := substring(v_in from '[?&]t=([A-Za-z0-9_-]+)');
  if v_tok is null and v_in ~ '^[A-Za-z0-9_-]{40,}$' then v_tok := v_in; end if;
  if v_tok is not null then
    if p_lock then select * into t from public.tickets where verify_token = v_tok for update;
    else select * into t from public.tickets where verify_token = v_tok; end if;
  else
    if p_lock then select * into t from public.tickets where upper(code) = upper(v_in) for update;
    else select * into t from public.tickets where upper(code) = upper(v_in); end if;
  end if;
  return t;   -- all-null row when nothing matched
end;
$$;

create or replace function public._ticket_verdict(t public.tickets, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare v_event text; v_type text; v_buyer text; v_by text; base jsonb;
begin
  if t.id is null then return jsonb_build_object('result','not_found'); end if;
  select e.name, tt.name, o.buyer_name into v_event, v_type, v_buyer
    from public.events e, public.ticket_types tt, public.orders o
   where e.id = t.event_id and tt.id = t.ticket_type_id and o.id = t.order_id;
  base := jsonb_build_object('code', t.code, 'event', v_event, 'type', v_type, 'buyer', v_buyer);
  if p_event_id is not null and t.event_id <> p_event_id then return base || '{"result":"wrong_event"}'::jsonb; end if;
  if t.status = 'void' then return base || '{"result":"void"}'::jsonb; end if;
  if t.status = 'used' then
    select name into v_by from public.team_members where id = t.scanned_by;
    return base || jsonb_build_object('result','already_used','used_at',t.used_at,
                                      'scanned_by', coalesce(v_by, 'the admin desk'));
  end if;
  return base || '{"result":"valid"}'::jsonb;
end;
$$;

-- step 1: look only
create or replace function public.team_scan(p_token text, p_event_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare m public.team_members%rowtype;
begin
  m := public._team_member(p_token);
  if m.role <> 'gate' then raise exception 'NOT_ALLOWED' using errcode = '28000'; end if;
  if not public._gate_open() then return jsonb_build_object('result','closed'); end if;
  return public._ticket_verdict(public._find_ticket(p_code, false), p_event_id);
end;
$$;

-- step 2: the official tapped Accept
create or replace function public.team_accept(p_token text, p_event_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare m public.team_members%rowtype; t public.tickets%rowtype; v jsonb;
begin
  m := public._team_member(p_token);
  if m.role <> 'gate' then raise exception 'NOT_ALLOWED' using errcode = '28000'; end if;
  if not public._gate_open() then return jsonb_build_object('result','closed'); end if;
  t := public._find_ticket(p_code, true);
  v := public._ticket_verdict(t, p_event_id);
  if v->>'result' <> 'valid' then return v; end if;     -- someone else got there first, or it changed
  update public.tickets set status = 'used', used_at = now(), scanned_by = m.id where id = t.id;
  return v || '{"result":"admitted"}'::jsonb;
end;
$$;

-- the portal polls this, so the switch reaches every gate within seconds
create or replace function public.team_stats(p_token text, p_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare m public.team_members%rowtype;
begin
  m := public._team_member(p_token);
  return jsonb_build_object(
    'gate_open',  public._gate_open(),
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

revoke all on function public._find_ticket(text, boolean) from public, anon, authenticated;
revoke all on function public._ticket_verdict(public.tickets, uuid) from public, anon, authenticated;
revoke all on function public._gate_open() from public, anon, authenticated;
grant execute on function public.team_accept(text, uuid, text), public.admin_set_gate_open(text, boolean) to anon, authenticated;
