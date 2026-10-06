-- Owner/staff can open and close vehicle registration. While closed the public links are
-- hidden and the database refuses new submissions, even from someone holding the page open.

insert into public.settings (key, value, is_public, updated_at)
values ('vehicle_registration_open', 'true', true, now())
on conflict (key) do nothing;

create or replace function public._vehicle_reg_open()
returns boolean language sql stable security definer set search_path to 'public', 'extensions' as $$
  select coalesce((select value <> 'false' from public.settings where key = 'vehicle_registration_open'), true);
$$;

create or replace function public.admin_set_vehicle_reg_open(p_pin text, p_open boolean)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
begin
  perform public._require_pin(p_pin);       -- owner or staff
  insert into public.settings (key, value, is_public, updated_at)
  values ('vehicle_registration_open', case when p_open then 'true' else 'false' end, true, now())
  on conflict (key) do update set value = excluded.value, is_public = true, updated_at = now();
  return jsonb_build_object('ok', true, 'open', p_open);
end;
$$;

-- same as before, with the switch checked first
create or replace function public.submit_vehicle_registration(
  p_event_id uuid, p_full_name text, p_phone text, p_email text,
  p_make text, p_model text, p_year int, p_colour text, p_plate text, p_photo_url text, p_notes text)
returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare v_plate text := public._norm_plate(p_plate); v_ref text;
begin
  if not public._vehicle_reg_open() then
    return jsonb_build_object('ok', false, 'closed', true, 'message', 'Vehicle registration is closed right now.');
  end if;
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
  if coalesce(p_photo_url,'') !~ '^https://ygfmcllmwtkfmcpgovbl\.supabase\.co/storage/v1/object/public/vehicle-photos/submissions/[A-Za-z0-9._-]+$' then
    return jsonb_build_object('ok', false, 'message', 'Please add a photo of the car.');
  end if;
  if p_event_id is not null and not exists (select 1 from public.events where id = p_event_id and status = 'published') then
    return jsonb_build_object('ok', false, 'message', 'That event isn''t open for registration.');
  end if;
  if exists (select 1 from public.vehicle_registrations
              where plate = v_plate and event_id is not distinct from p_event_id and status <> 'rejected') then
    return jsonb_build_object('ok', false, 'message', 'This number plate is already registered for this event.');
  end if;
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

revoke all on function public._vehicle_reg_open() from public, anon, authenticated;
grant execute on function public.admin_set_vehicle_reg_open(text, boolean) to anon, authenticated;
