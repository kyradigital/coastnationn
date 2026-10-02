-- The QR on every ticket is a verify.html?t=<token> link, but admin_scan_ticket only
-- matched the short CN… code, so the in-app scanner said "not a valid code" for every QR.
-- Accept the link, a bare token, or the short code — and do the check + mark-used in one locked step.
CREATE OR REPLACE FUNCTION public.admin_scan_ticket(p_pin text, p_code text, p_mark_used boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_t public.tickets%rowtype; v_event text; v_type text; v_buyer text;
        v_in text := trim(coalesce(p_code,'')); v_token text;
begin
  perform public._require_pin(p_pin);

  v_token := substring(v_in from '[?&]t=([A-Za-z0-9_-]+)');
  if v_token is null and v_in ~ '^[A-Za-z0-9_-]{40,}$' then v_token := v_in; end if;

  if v_token is not null then
    select * into v_t from public.tickets where verify_token = v_token for update;
  else
    select * into v_t from public.tickets where upper(code) = upper(v_in) for update;
  end if;
  if not found then return jsonb_build_object('result','not_found'); end if;

  select e.name, tt.name, o.buyer_name into v_event, v_type, v_buyer
  from public.events e, public.ticket_types tt, public.orders o
  where e.id = v_t.event_id and tt.id = v_t.ticket_type_id and o.id = v_t.order_id;

  if v_t.status = 'used' then
    return jsonb_build_object('result','already_used','code',v_t.code,'event',v_event,'type',v_type,'buyer',v_buyer,'used_at',v_t.used_at);
  elsif v_t.status = 'void' then
    return jsonb_build_object('result','void','code',v_t.code,'event',v_event,'type',v_type,'buyer',v_buyer);
  end if;

  if p_mark_used then
    update public.tickets set status = 'used', used_at = now() where id = v_t.id;
  end if;
  return jsonb_build_object('result','valid','code',v_t.code,'event',v_event,'type',v_type,'buyer',v_buyer);
end;
$function$;
