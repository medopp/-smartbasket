-- Additive release; exact LN- is an internal intake marker, never a customer account.
alter table public.sb_unknown_shipments add column intake_data jsonb not null default '{}'::jsonb
 check (jsonb_typeof(intake_data)='object');

create function public.sb_import_with_unknowns(p_rows jsonb,p_trip text,p_country text,p_mode text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor text:=public.sb_service_role(array['admin','staff','warehouse']);
 t public.sb_trips; r jsonb; u public.sb_unknown_shipments; qty numeric; identifier text;
 normal_rows jsonb:='[]'; unknown_rows jsonb:='[]'; added integer:=0; existing_count integer:=0;
 result jsonb:=jsonb_build_object('created',0,'updated',0,'batchId',coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-sb-batch');
begin
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'SB:دفعة غير صالحة.';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_rows))<>jsonb_array_length(p_rows) then raise exception 'SB:أرقام مكررة داخل الدفعة.';end if;
 select * into t from public.sb_trips where trip_code=p_trip and country=p_country and mode=p_mode for update;
 if not found then raise exception 'SB:الرحلة غير موجودة.';end if;
 -- Stable order and one transaction for both destinations; never partly import a manifest.
 for r in select value from jsonb_array_elements(p_rows) order by value->>'id' loop
  identifier=r->>'id';
  if identifier is null or identifier !~ '^[A-Z0-9-]{2,64}$' or identifier='LN-' then raise exception 'SB:رقم تتبع غير صالح.';end if;
  if r->>'customer' is distinct from 'LN-' then
   if exists(select 1 from public.sb_unknown_shipments where tracking=identifier and status='unresolved') then raise exception 'SB:التتبع موجود في المجهولة؛ تحقق من الملكية واربطه من قسم المجهولة أولًا.';end if;
   normal_rows=normal_rows||jsonb_build_array(r);continue;
  end if;
  if coalesce(r->>'action','') not in ('create','unknown') then raise exception 'SB:لا يمكن تحويل شحنة مرتبطة بزبون إلى مجهولة بهذه العملية.';end if;
  qty=(r->>'weight')::numeric;
  if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty>100000 or
   (r->>'unit') is distinct from (case when t.mode='جوي' then 'كجم' else 'متر مكعب' end) or
   length(coalesce(r->>'category','عام')) not between 1 and 80 then raise exception 'SB:راجع الوزن والوحدة والتصنيف.';end if;
  perform pg_advisory_xact_lock(hashtextextended('sb-unknown-tracking:'||identifier,0));
  if exists(select 1 from public.sb_shipments where id=identifier) then raise exception 'SB:التتبع مرتبط بزبون بالفعل؛ لم يتم تغيير ملكيته. استبعد الصف وراجع الشحنة.';end if;
  select * into u from public.sb_unknown_shipments where tracking=identifier for update;
  if found then
   existing_count=existing_count+1;
  else
   insert into public.sb_unknown_shipments(id,tracking,description,received_on,created_by,intake_data)
   values(gen_random_uuid(),identifier,'شحنة مسجلة بكود زبون ناقص LN-؛ تحتاج التحقق من المالك.',(now() at time zone 'Africa/Tripoli')::date,actor,
    jsonb_build_object('source','LN-','trip',t.trip_code,'country',t.country,'mode',t.mode,'weight',qty,'unit',r->>'unit','category',coalesce(r->>'category','عام'),'arrivalDate',t.arrival_date))
   returning * into u;
   added=added+1;
  end if;
  unknown_rows=unknown_rows||jsonb_build_array(jsonb_build_object('id',u.id,'tracking',u.tracking,'updatedAt',u.updated_at));
 end loop;
 if jsonb_array_length(normal_rows)>0 then result=public.sb_operations_batch('import',normal_rows,p_trip,p_country,p_mode);end if;
 return result||jsonb_build_object('unknownCreated',added,'unknownExisting',existing_count,'unknownRows',unknown_rows);
end $$;
revoke all on function public.sb_import_with_unknowns(jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.sb_import_with_unknowns(jsonb,text,text,text) to service_role;

create or replace function public.sb_unknown_link(p_id uuid,p_data jsonb,p_expected timestamptz)
returns jsonb language plpgsql set search_path='' as $$
declare actor text:=public.sb_service_role(array['admin','staff','warehouse']); r public.sb_unknown_shipments;
 cust text:=p_data->>'customer'; v_tracking text:=p_data->>'tracking'; t public.sb_trips; s public.sb_shipments;
begin
 select * into r from public.sb_unknown_shipments where id=p_id for update;
 if not found then raise exception 'SB:الشحنة غير موجودة.';end if;
 if r.status='linked' then
  if r.linked_shipment_id=v_tracking and r.customer_code=cust then return jsonb_build_object('ok',true,'shipment',r.linked_shipment_id,'replayed',true);end if;
  raise exception 'SB:سبق ربط هذه الشحنة بزبون؛ لا يمكن استبدال المالك من هنا.';
 end if;
 if r.updated_at is distinct from p_expected then raise exception 'SB:تغيرت الشحنة؛ حدّث القائمة قبل الربط.';end if;
 if v_tracking is null or v_tracking !~ '^[A-Z0-9-]{2,64}$' or v_tracking='LN-' or (r.tracking is not null and r.tracking<>v_tracking) then raise exception 'SB:أدخل رقم التتبع الحقيقي المسجل على الشحنة.';end if;
 if coalesce(p_data->>'confirmed','false')<>'true' or length(btrim(coalesce(p_data->>'confirmation','')))<5 or length(p_data->>'confirmation')>600 then raise exception 'SB:أكد ملكية الزبون وسجّل دليل التحقق.';end if;
 perform 1 from public.sb_accounts where code=cust and role='customer' and active for share;
 if not found then raise exception 'SB:اختر حساب زبون موجودًا ومفعّلًا.';end if;
 select * into t from public.sb_trips where trip_code=p_data->>'trip' and country=p_data->>'country' and mode=p_data->>'mode' for share;
 if not found or t.step<>0 then raise exception 'SB:اختر رحلة محفوظة لم تغادر المخزن.';end if;
 if coalesce((p_data->>'weight')::numeric,0)<=0 or (p_data->>'weight')::numeric>100000 or
  (p_data->>'unit') is distinct from (case when t.mode='جوي' then 'كجم' else 'متر مكعب' end) or
  coalesce((p_data->>'step')::integer,-1) not between 0 and 3 then raise exception 'SB:راجع الوزن والوحدة وحالة الشحنة.';end if;
 if exists(select 1 from public.sb_unknown_shipments q where q.tracking=v_tracking and q.id<>p_id) then raise exception 'SB:التتبع مستخدم في شحنة مجهولة أخرى.';end if;
 if exists(select 1 from public.sb_shipments where id=v_tracking) then raise exception 'SB:التتبع موجود أصلًا؛ لم يتم استبدال الشحنة الموجودة.';end if;
 insert into public.sb_shipments(id,customer_code,country,mode,weight,unit,trip,ship_date,step,photo_key,photo_bytes,category)
 values(v_tracking,cust,t.country,t.mode,(p_data->>'weight')::numeric,p_data->>'unit',t.trip_code,t.arrival_date,(p_data->>'step')::integer,r.photo_key,r.photo_bytes,coalesce(r.intake_data->>'category','عام')) returning * into s;
 update public.sb_unknown_shipments set status='linked',tracking=v_tracking,customer_code=cust,
 linked_shipment_id=s.id,confirmation_note=btrim(p_data->>'confirmation'),confirmed_by=actor,confirmed_at=clock_timestamp() where id=p_id;
 return jsonb_build_object('ok',true,'shipment',s.id);
end $$;
