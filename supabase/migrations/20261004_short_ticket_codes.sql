-- Short ticket codes: new tickets get CN-482913 (CN + 6 digits) instead of CN + 10 hex.
-- Gate officials type just the 6 digits on the number pad. Lookups ignore case, spaces,
-- dashes and the CN prefix, so "482913", "cn 482 913" and "CN-482913" all find the same ticket.
-- Existing tickets keep their old codes, which still work.

-- normalised form used for every typed lookup: CN482913 / CN2955F040BC
create or replace function public._norm_code(p text)
returns text language sql immutable as $$
  select case
    when upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g')) ~ '^[0-9]{6}$'
      then 'CN' || regexp_replace(coalesce(p,''), '[^0-9]', '', 'g')
    else upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g'))
  end;
$$;

create unique index if not exists tickets_code_norm_idx on public.tickets (public._norm_code(code));
create index if not exists tickets_ticket_type_id_idx on public.tickets (ticket_type_id);
create index if not exists order_items_ticket_type_id_idx on public.order_items (ticket_type_id);

-- crypto-random 6 digits; retries on the rare clash
create or replace function public._new_ticket_code()
returns text language plpgsql volatile security definer set search_path to 'public', 'extensions' as $$
declare v text; n int := 0;
begin
  loop
    v := 'CN-' || lpad(((('x' || '00000000' || encode(gen_random_bytes(4), 'hex'))::bit(64)::bigint) % 1000000)::text, 6, '0');
    exit when not exists (select 1 from public.tickets where public._norm_code(code) = public._norm_code(v));
    n := n + 1;
    if n > 50 then raise exception 'TICKET_CODE_SPACE_EXHAUSTED'; end if;
  end loop;
  return v;
end;
$$;

create or replace function public._mark_order_paid(p_order_id uuid, p_provider text, p_provider_ref text, p_verified boolean)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_order public.orders%rowtype; v_item public.order_items%rowtype; i int;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if v_order.status = 'paid' then
    update public.orders
      set payment_verified = payment_verified or p_verified,
          payment_ref = coalesce(p_provider_ref, payment_ref)
      where id = p_order_id;
    return jsonb_build_object('reference', v_order.reference, 'already_paid', true);
  end if;

  update public.orders
     set status = 'paid', paid_at = now(), payment_provider = p_provider,
         payment_ref = p_provider_ref, payment_verified = p_verified
   where id = p_order_id;

  for v_item in select * from public.order_items where order_id = p_order_id loop
    for i in 1..v_item.quantity loop
      insert into public.tickets (order_id, event_id, ticket_type_id, code, holder_name, verify_token)
      values (p_order_id, v_order.event_id, v_item.ticket_type_id,
              public._new_ticket_code(), v_order.buyer_name,
              encode(gen_random_bytes(24), 'hex'));
    end loop;
    update public.ticket_types set quantity_sold = quantity_sold + v_item.quantity where id = v_item.ticket_type_id;
  end loop;

  return jsonb_build_object('reference', v_order.reference, 'already_paid', false);
end;
$$;

-- QR link, bare token, or any typed form of the code
create or replace function public._find_ticket(p_code text, p_lock boolean)
returns public.tickets language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_in text := trim(coalesce(p_code,'')); v_tok text; t public.tickets%rowtype;
begin
  v_tok := substring(v_in from '[?&]t=([A-Za-z0-9_-]+)');
  if v_tok is null and v_in ~ '^[A-Za-z0-9_-]{40,}$' then v_tok := v_in; end if;
  if v_tok is not null then
    if p_lock then select * into t from public.tickets where verify_token = v_tok for update;
    else select * into t from public.tickets where verify_token = v_tok; end if;
  elsif v_in <> '' then
    if p_lock then select * into t from public.tickets where public._norm_code(code) = public._norm_code(v_in) for update;
    else select * into t from public.tickets where public._norm_code(code) = public._norm_code(v_in); end if;
  end if;
  return t;
end;
$$;

-- the admin's own scanner: same lookup, same answers as before
create or replace function public.admin_scan_ticket(p_pin text, p_code text, p_mark_used boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare t public.tickets%rowtype; v jsonb;
begin
  perform public._require_pin(p_pin);
  t := public._find_ticket(p_code, true);
  v := public._ticket_verdict(t, null);
  if v->>'result' = 'valid' and p_mark_used then
    update public.tickets set status = 'used', used_at = now() where id = t.id;
  end if;
  return v;
end;
$$;

create or replace function public.admin_void_ticket(p_pin text, p_code text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
begin
  perform public._require_pin(p_pin);
  update public.tickets set status = 'void', voided_at = now()
   where public._norm_code(code) = public._norm_code(p_code);
  if not found then return jsonb_build_object('ok', false, 'message', 'No ticket with that code.'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public._new_ticket_code() from public, anon, authenticated;
