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
 values(v_tracking,cust,t.country,t.mode,(p_data->>'weight')::numeric,p_data->>'unit',t.trip_code,t.arrival_date,(p_data->>'step')::integer,r.photo_key,r.photo_bytes,'عام') returning * into s;
 update public.sb_unknown_shipments set status='linked',tracking=v_tracking,customer_code=cust,
 linked_shipment_id=s.id,confirmation_note=btrim(p_data->>'confirmation'),confirmed_by=actor,confirmed_at=clock_timestamp() where id=p_id;
 return jsonb_build_object('ok',true,'shipment',s.id);
end $$;
