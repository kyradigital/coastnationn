-- Vehicle registration (public form → admin approval), the admin activity feed, and the
-- "today" briefing on the dashboard.

/* ---------------- storage ---------------- */

-- Nothing on the site overwrites an image (every upload is a new file), but this policy let
-- anyone with the public key replace the event posters and the logo. Close it.
drop policy if exists "event images can be updated" on storage.objects;

-- car photos: public to view (random file names), upload-only for the public, images ≤ 5MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-photos', 'vehicle-photos', true, 5242880,
        array['image/png','image/jpeg','image/jpg','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

drop policy if exists "vehicle photos are publicly readable" on storage.objects;
create policy "vehicle photos are publicly readable" on storage.objects
  for select to anon, authenticated using (bucket_id = 'vehicle-photos');
drop policy if exists "vehicle photos can be uploaded" on storage.objects;
create policy "vehicle photos can be uploaded" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'vehicle-photos' and (storage.foldername(name))[1] = 'submissions');

/* ---------------- registrations ---------------- */

create table if not exists public.vehicle_registrations (
  id           uuid primary key default gen_random_uuid(),
  reference    text not null unique,
  event_id     uuid references public.events(id) on delete set null,
  full_name    text not null,
  phone        text not null,
  email        text,
  make         text not null,
  model        text not null,
  year         int,
  colour       text,
  plate        text not null,
  photo_url    text not null,
  notes        text,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note  text,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.vehicle_registrations enable row level security;
create index if not exists vehicle_registrations_status_idx on public.vehicle_registrations(status, created_at desc);
create index if not exists vehicle_registrations_event_idx on public.vehicle_registrations(event_id);
create index if not exists vehicle_registrations_plate_idx on public.vehicle_registrations(plate);

-- "kca 123a" / "KCA-123A" -> "KCA 123A"
create or replace function public._norm_plate(p text)
returns text language sql immutable as $$
  select trim(regexp_replace(upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9 ]', ' ', 'g')), '\s+', ' ', 'g'));
$$;

create or replace function public.submit_vehicle_registration(
  p_event_id uuid, p_full_name text, p_phone text, p_email text,
  p_make text, p_model text, p_year int, p_colour text, p_plate text, p_photo_url text, p_notes text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_plate text := public._norm_plate(p_plate); v_ref text;
begin
  if coalesce(trim(p_full_name),'') = '' or coalesce(trim(p_phone),'') = ''
     or coalesce(trim(p_make),'') = '' or coalesce(trim(p_model),'') = '' then
    return jsonb_build_object('ok', false, 'message', 'Please fill in your name, phone, and the car''s make and model.');
  end if;
  if length(v_plate) < 4 or length(v_plate) > 12 then
    return jsonb_build_object('ok', false, 'message', 'That number plate doesn''t look right.');
  end if;
  if p_year is not null and (p_year < 1900 or p_year > extract(year from now())::int + 1) then
    return jsonb_build_object('ok', false, 'message', 'Check the year of the car.');
  end if;
  if p_email is not null and trim(p_email) <> '' and trim(p_email) !~ '^\S+@\S+\.\S+$' then
    return jsonb_build_object('ok', false, 'message', 'That email doesn''t look right.');
  end if;

  -- the photo must be one this form uploaded to our own bucket
  if coalesce(p_photo_url,'') !~ '^https://ygfmcllmwtkfmcpgovbl\.supabase\.co/storage/v1/object/public/vehicle-photos/submissions/[A-Za-z0-9._-]+$' then
    return jsonb_build_object('ok', false, 'message', 'Please add a photo of the car.');
  end if;

  if p_event_id is not null and not exists (select 1 from public.events where id = p_event_id and status = 'published') then
    return jsonb_build_object('ok', false, 'message', 'That event isn''t open for registration.');
  end if;

  -- one live registration per plate per event; a rejected one may try again
  if exists (select 1 from public.vehicle_registrations
              where plate = v_plate and event_id is not distinct from p_event_id and status <> 'rejected') then
    return jsonb_build_object('ok', false, 'message', 'This number plate is already registered for this event.');
  end if;

  -- crude flood guard: the form is public
  if (select count(*) from public.vehicle_registrations where created_at > now() - interval '10 minutes') >= 30 then
    return jsonb_build_object('ok', false, 'message', 'Lots of registrations right now — please try again in a few minutes.');
  end if;

  loop
    v_ref := 'VR-' || upper(encode(gen_random_bytes(3), 'hex'));
    exit when not exists (select 1 from public.vehicle_registrations where reference = v_ref);
  end loop;

  insert into public.vehicle_registrations
    (reference, event_id, full_name, phone, email, make, model, year, colour, plate, photo_url, notes)
  values
    (v_ref, p_event_id, left(trim(p_full_name), 120), left(trim(p_phone), 40), nullif(lower(trim(coalesce(p_email,''))), ''),
     left(trim(p_make), 60), left(trim(p_model), 60), p_year, nullif(left(trim(coalesce(p_colour,'')), 40), ''),
     v_plate, p_photo_url, nullif(left(trim(coalesce(p_notes,'')), 500), ''));

  return jsonb_build_object('ok', true, 'reference', v_ref);
end;
$$;

create or replace function public.admin_vehicle_list(p_pin text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
begin
  perform public._require_pin(p_pin);
  return coalesce((
    select jsonb_agg(to_jsonb(v) || jsonb_build_object('event_name', e.name) order by v.created_at desc)
      from public.vehicle_registrations v left join public.events e on e.id = v.event_id), '[]'::jsonb);
end;
$$;

create or replace function public.admin_vehicle_review(p_pin text, p_id uuid, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
begin
  perform public._require_pin(p_pin);
  if p_status not in ('pending','approved','rejected') then raise exception 'BAD_STATUS'; end if;
  update public.vehicle_registrations
     set status = p_status, review_note = nullif(trim(coalesce(p_note,'')), ''),
         reviewed_at = case when p_status = 'pending' then null else now() end
   where id = p_id;
  return jsonb_build_object('ok', found);
end;
$$;

create or replace function public.admin_vehicle_delete(p_pin text, p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
begin
  perform public._require_owner(p_pin);
  delete from public.vehicle_registrations where id = p_id;
  return jsonb_build_object('ok', found);
end;
$$;

/* ---------------- activity feed + today's briefing ---------------- */

-- Everything worth knowing from the last 48 hours, newest first. Times are UTC; the page
-- shows them in the viewer's local time.
create or replace function public.admin_activity(p_pin text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
begin
  perform public._require_pin(p_pin);
  return coalesce((
    select jsonb_agg(a order by a.at desc) from (
      select o.paid_at as at, 'sale' as kind,
             o.buyer_name || ' bought ' || coalesce((select sum(quantity) from public.order_items where order_id = o.id), 0)
               || ' ticket' || case when coalesce((select sum(quantity) from public.order_items where order_id = o.id), 0) = 1 then '' else 's' end
               || ' · ' || e.name as text,
             o.total_amount as amount, o.reference as ref
        from public.orders o join public.events e on e.id = o.event_id
       where o.status = 'paid' and o.paid_at > now() - interval '48 hours'
      union all
      select v.created_at, 'vehicle', v.full_name || ' registered a ' || v.make || ' ' || v.model || ' (' || v.plate || ')',
             null, v.reference
        from public.vehicle_registrations v where v.created_at > now() - interval '48 hours'
      union all
      -- check-ins come in bursts at the gate, so group them by hour
      select date_trunc('hour', t.used_at) + interval '59 minutes', 'checkin',
             count(*) || ' guest' || case when count(*) = 1 then '' else 's' end || ' checked in at the gate',
             null, null
        from public.tickets t where t.status = 'used' and t.used_at > now() - interval '48 hours'
       group by date_trunc('hour', t.used_at)
      order by 1 desc limit 60
    ) a), '[]'::jsonb);
end;
$$;

-- The numbers behind "Today": midnight-to-now in Nairobi, plus the same stretch yesterday.
create or replace function public.admin_today(p_pin text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare v_start timestamptz := date_trunc('day', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi';
        v_y timestamptz := v_start - interval '1 day';
        v_elapsed interval := now() - v_start;
begin
  perform public._require_pin(p_pin);
  return jsonb_build_object(
    'tickets',  (select coalesce(sum(oi.quantity),0) from public.orders o join public.order_items oi on oi.order_id = o.id
                  where o.status = 'paid' and o.paid_at >= v_start),
    'revenue',  (select coalesce(sum(total_amount),0) from public.orders where status = 'paid' and paid_at >= v_start),
    'orders',   (select count(*) from public.orders where status = 'paid' and paid_at >= v_start),
    'tickets_yesterday_so_far', (select coalesce(sum(oi.quantity),0) from public.orders o join public.order_items oi on oi.order_id = o.id
                  where o.status = 'paid' and o.paid_at >= v_y and o.paid_at < v_y + v_elapsed),
    'abandoned', (select count(*) from public.orders where status = 'pending' and created_at >= v_start and created_at < now() - interval '30 minutes'),
    'vehicles',  (select count(*) from public.vehicle_registrations where created_at >= v_start),
    'vehicles_pending', (select count(*) from public.vehicle_registrations where status = 'pending'),
    'checkins',  (select count(*) from public.tickets where status = 'used' and used_at >= v_start),
    'top_type',  (select jsonb_build_object('name', oi.ticket_type_name, 'qty', sum(oi.quantity))
                    from public.orders o join public.order_items oi on oi.order_id = o.id
                   where o.status = 'paid' and o.paid_at >= v_start
                   group by oi.ticket_type_name order by sum(oi.quantity) desc limit 1),
    'next_event', (select jsonb_build_object('name', e.name, 'date', e.event_date,
                     'days', e.event_date - (now() at time zone 'Africa/Nairobi')::date,
                     'sold', (select count(*) from public.tickets t where t.event_id = e.id and t.status in ('valid','used')))
                     from public.events e where e.status = 'published' and e.event_date >= (now() at time zone 'Africa/Nairobi')::date
                    order by e.event_date limit 1)
  );
end;
$$;

grant execute on function public.submit_vehicle_registration(uuid, text, text, text, text, text, int, text, text, text, text),
                          public.admin_vehicle_list(text), public.admin_vehicle_review(text, uuid, text, text),
                          public.admin_vehicle_delete(text, uuid), public.admin_activity(text), public.admin_today(text)
  to anon, authenticated;
