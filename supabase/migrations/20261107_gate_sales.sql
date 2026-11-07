-- Gate sales: while gate check-ins are ON, the event page sells only the event's gate ticket
-- (e.g. "Gate" — KES 1,350). No details, no email code: pick a quantity, pay, and the QR shows
-- on the buyer's phone. Gate tickets never appear in normal online sales.

alter table public.ticket_types add column if not exists gate_only boolean not null default false;

alter table public.orders drop constraint if exists orders_delivery_method_check;
alter table public.orders add constraint orders_delivery_method_check
  check (delivery_method = any (array['email','whatsapp','screen']));

insert into public.ticket_types (event_id, name, description, price, quantity_total, is_active, sort_order, gate_only)
select 'f59970af-24f4-490b-99b1-6971c14ca25a', 'Gate', 'Bought at the gate', 1350, 0, true, 99, true
where not exists (select 1 from public.ticket_types
                   where event_id = 'f59970af-24f4-490b-99b1-6971c14ca25a' and gate_only);

create or replace function public.create_gate_order(p_event_id uuid, p_quantity int)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_tt public.ticket_types%rowtype; v_qty int := coalesce(p_quantity, 0); v_order uuid; v_ref text; v_total numeric(12,2);
begin
  if not public._gate_open() then raise exception 'GATE_SALES_CLOSED'; end if;
  if v_qty < 1 or v_qty > 10 then raise exception 'BAD_QUANTITY'; end if;
  if not exists (select 1 from public.events where id = p_event_id and status = 'published') then
    raise exception 'EVENT_NOT_AVAILABLE';
  end if;
  select * into v_tt from public.ticket_types
   where event_id = p_event_id and gate_only and is_active
   order by sort_order, price limit 1 for update;
  if not found then raise exception 'GATE_SALES_CLOSED'; end if;
  if v_tt.quantity_total > 0 and (v_tt.quantity_sold + v_qty) > v_tt.quantity_total then raise exception 'SOLD_OUT'; end if;

  v_total := v_tt.price * v_qty;
  v_ref := 'CN-' || to_char(now(), 'YYMMDD') || '-' || public._new_code(6);
  insert into public.orders (id, reference, event_id, buyer_name, buyer_email, buyer_phone,
                             total_amount, status, delivery_method, contact_verified)
  values (gen_random_uuid(), v_ref, p_event_id, 'Gate sale', 'gate-sales@coastnation.online', 'At the gate',
          v_total, 'pending', 'screen', false)
  returning id into v_order;
  insert into public.order_items (order_id, ticket_type_id, ticket_type_name, unit_price, quantity)
  values (v_order, v_tt.id, v_tt.name, v_tt.price, v_qty);

  return jsonb_build_object('order_id', v_order, 'reference', v_ref, 'total', v_total, 'quantity', v_qty,
                            'email', 'gate-sales@coastnation.online');
end;
$$;
grant execute on function public.create_gate_order(uuid, int) to anon, authenticated;

-- online checkout: unchanged, except gate tickets can't be bought through it
create or replace function public.create_order(p_event_id uuid, p_buyer_name text, p_buyer_email text, p_buyer_phone text, p_items jsonb, p_verify_token text default null::text, p_delivery_method text default 'email'::text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  v_order_id uuid; v_ref text; v_total numeric(12,2) := 0; v_item jsonb;
  v_tt public.ticket_types%rowtype; v_qty int; v_count int := 0;
  v_required text; v_vc public.verified_contacts%rowtype; v_email text;
begin
  if coalesce(trim(p_buyer_name),'') = '' or coalesce(trim(p_buyer_email),'') = '' or coalesce(trim(p_buyer_phone),'') = '' then
    raise exception 'MISSING_BUYER_DETAILS';
  end if;
  if not exists (select 1 from public.events where id = p_event_id and status = 'published') then
    raise exception 'EVENT_NOT_AVAILABLE';
  end if;
  v_email := lower(trim(p_buyer_email));
  select value into v_required from public.settings where key = 'otp_required';
  if coalesce(v_required,'true') = 'true' then
    if coalesce(p_verify_token,'') = '' then raise exception 'CONTACT_NOT_VERIFIED'; end if;
    select * into v_vc from public.verified_contacts
     where token = p_verify_token and expires_at > now() and used_by_order is null;
    if not found then raise exception 'VERIFICATION_EXPIRED'; end if;
    if v_vc.destination <> v_email then raise exception 'VERIFICATION_MISMATCH'; end if;
  end if;
  v_ref := 'CN-' || to_char(now(), 'YYMMDD') || '-' || public._new_code(6);
  insert into public.orders (id, reference, event_id, buyer_name, buyer_email, buyer_phone,
                             total_amount, status, delivery_method, contact_verified, verified_channel)
  values (gen_random_uuid(), v_ref, p_event_id, trim(p_buyer_name), v_email, trim(p_buyer_phone),
          0, 'pending',
          case when p_delivery_method = 'whatsapp' then 'whatsapp' else 'email' end,
          v_vc.token is not null, v_vc.channel)
  returning id into v_order_id;
  if v_vc.token is not null then
    update public.verified_contacts set used_by_order = v_order_id where token = v_vc.token;
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(coalesce((v_item->>'quantity')::int, 0), 0);
    if v_qty = 0 then continue; end if;
    select * into v_tt from public.ticket_types
      where id = (v_item->>'ticket_type_id')::uuid and event_id = p_event_id and is_active and not gate_only for update;
    if not found then raise exception 'TICKET_TYPE_NOT_FOUND'; end if;
    if v_tt.sales_end is not null and v_tt.sales_end < now() then raise exception 'SALES_CLOSED'; end if;
    if v_tt.quantity_total > 0 and (v_tt.quantity_sold + v_qty) > v_tt.quantity_total then raise exception 'SOLD_OUT'; end if;
    insert into public.order_items (order_id, ticket_type_id, ticket_type_name, unit_price, quantity)
    values (v_order_id, v_tt.id, v_tt.name, v_tt.price, v_qty);
    v_total := v_total + (v_tt.price * v_qty);
    v_count := v_count + v_qty;
  end loop;
  if v_count = 0 then raise exception 'NO_TICKETS_SELECTED'; end if;
  update public.orders set total_amount = v_total where id = v_order_id;
  return jsonb_build_object('order_id', v_order_id, 'reference', v_ref, 'total', v_total, 'quantity', v_count);
end;
$$;

-- admin ticket editor: keep the gate flag editable
create or replace function public.admin_save_ticket_type(p_pin text, p_tt jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_id uuid;
begin
  perform public._require_pin(p_pin);
  v_id := nullif(p_tt->>'id','')::uuid;
  if v_id is null then
    insert into public.ticket_types (event_id, name, description, tagline, price, quantity_total, sales_end, is_active, sort_order, gate_only)
    values ((p_tt->>'event_id')::uuid, p_tt->>'name', p_tt->>'description',
            nullif(left(trim(coalesce(p_tt->>'tagline','')), 40), ''),
            coalesce((p_tt->>'price')::numeric, 0), coalesce((p_tt->>'quantity_total')::int, 0),
            nullif(p_tt->>'sales_end','')::timestamptz, coalesce((p_tt->>'is_active')::boolean, true),
            coalesce((p_tt->>'sort_order')::int, 0), coalesce((p_tt->>'gate_only')::boolean, false))
    returning id into v_id;
  else
    update public.ticket_types set
      name           = case when p_tt ? 'name' and nullif(p_tt->>'name','') is not null then p_tt->>'name' else name end,
      description    = case when p_tt ? 'description'    then p_tt->>'description' else description end,
      tagline        = case when p_tt ? 'tagline'        then nullif(left(trim(coalesce(p_tt->>'tagline','')), 40), '') else tagline end,
      price          = case when p_tt ? 'price'          then coalesce((p_tt->>'price')::numeric, price) else price end,
      quantity_total = case when p_tt ? 'quantity_total' then coalesce((p_tt->>'quantity_total')::int, quantity_total) else quantity_total end,
      sales_end      = case when p_tt ? 'sales_end'      then nullif(p_tt->>'sales_end','')::timestamptz else sales_end end,
      is_active      = case when p_tt ? 'is_active'      then coalesce((p_tt->>'is_active')::boolean, is_active) else is_active end,
      sort_order     = case when p_tt ? 'sort_order'     then coalesce((p_tt->>'sort_order')::int, sort_order) else sort_order end,
      gate_only      = case when p_tt ? 'gate_only'      then coalesce((p_tt->>'gate_only')::boolean, gate_only) else gate_only end
    where id = v_id;
  end if;
  return (select row_to_json(t)::jsonb from public.ticket_types t where t.id = v_id);
end;
$$;
