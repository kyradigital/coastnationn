-- A short line per ticket type ("25 LEFT!", "SELLING FAST") shown as a badge on the
-- homepage event card when that ticket is the one on sale, and beside it on the event page.

alter table public.ticket_types add column if not exists tagline text
  check (tagline is null or char_length(tagline) <= 40);

create or replace function public.admin_save_ticket_type(p_pin text, p_tt jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_id uuid;
begin
  perform public._require_pin(p_pin);
  v_id := nullif(p_tt->>'id','')::uuid;
  if v_id is null then
    insert into public.ticket_types (event_id, name, description, tagline, price, quantity_total, sales_end, is_active, sort_order)
    values ((p_tt->>'event_id')::uuid, p_tt->>'name', p_tt->>'description',
            nullif(left(trim(coalesce(p_tt->>'tagline','')), 40), ''),
            coalesce((p_tt->>'price')::numeric, 0), coalesce((p_tt->>'quantity_total')::int, 0),
            nullif(p_tt->>'sales_end','')::timestamptz, coalesce((p_tt->>'is_active')::boolean, true),
            coalesce((p_tt->>'sort_order')::int, 0))
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
      sort_order     = case when p_tt ? 'sort_order'     then coalesce((p_tt->>'sort_order')::int, sort_order) else sort_order end
    where id = v_id;
  end if;
  return (select row_to_json(t)::jsonb from public.ticket_types t where t.id = v_id);
end;
$$;
